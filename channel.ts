/**
 * Channel Plugin Module
 * 
 * This module defines the ChannelPlugin object that integrates with OpenClaw,
 * including metadata, capabilities, configuration schema, and gateway/outbound methods.
 * 
 * IMPORTANT: This plugin acts as a REQUEST RESPONDER in the Open Responses protocol.
 * The server sends requests to the plugin, and the plugin responds with event sequences.
 * The plugin does NOT actively initiate messages - it only responds to server requests.
 * 
 * Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4,
 *            5.1, 5.2, 5.3, 5.4, 5.5, 8.1, 8.2, 8.3, 8.4, 8.5, 1.3
 */

import type { ChannelPlugin } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import {
  CHANNEL_ID,
  listInstaClawAccountIds,
  resolveInstaClawAccount,
  type ResolvedInstaClawAccount,
} from "./account-config";
import { monitorInstaClawProvider } from "./connection";
import { createEnvelope, textToEventSequence } from "./protocol";
import { DebugLogger } from "./logger";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const YINTAI_TASKS_RUNNER_SKILL_KEY = "yintai_tasks_runner";

function syncSkillCredentials(account: ResolvedInstaClawAccount, logger: DebugLogger): void {
  if (!account.clientId || !account.clientSecret) {
    return;
  }

  const openclawConfigPath = path.join(os.homedir(), ".openclaw", "openclaw.json");

  try {
    let openclawConfig: Record<string, any> = {};

    if (fs.existsSync(openclawConfigPath)) {
      const raw = fs.readFileSync(openclawConfigPath, "utf-8");
      openclawConfig = raw.trim() ? JSON.parse(raw) : {};
    }

    if (!openclawConfig["skills"] || typeof openclawConfig["skills"] !== "object") {
      openclawConfig["skills"] = {};
    }
    if (
      !openclawConfig["skills"]["entries"] ||
      typeof openclawConfig["skills"]["entries"] !== "object"
    ) {
      openclawConfig["skills"]["entries"] = {};
    }

    const existingEntry =
      openclawConfig["skills"]["entries"][YINTAI_TASKS_RUNNER_SKILL_KEY] &&
      typeof openclawConfig["skills"]["entries"][YINTAI_TASKS_RUNNER_SKILL_KEY] === "object"
        ? openclawConfig["skills"]["entries"][YINTAI_TASKS_RUNNER_SKILL_KEY]
        : {};

    openclawConfig["skills"]["entries"][YINTAI_TASKS_RUNNER_SKILL_KEY] = {
      ...existingEntry,
      enabled: true,
      apiKey: account.clientId,
      env: {
        ...(existingEntry.env && typeof existingEntry.env === "object" ? existingEntry.env : {}),
        YINTAI_APP_KEY: account.clientId,
        YINTAI_APP_SECRET: account.clientSecret,
      },
    };

    const openclawDir = path.dirname(openclawConfigPath);
    if (!fs.existsSync(openclawDir)) {
      fs.mkdirSync(openclawDir, { recursive: true });
    }

    fs.writeFileSync(openclawConfigPath, JSON.stringify(openclawConfig, null, 2), "utf-8");

    logger.info("Synchronized skill credentials to openclaw.json", {
      configPath: openclawConfigPath,
      skillKey: YINTAI_TASKS_RUNNER_SKILL_KEY,
      apiKeyLength: account.clientId.length,
    });
  } catch (err) {
    logger.error("Failed to synchronize skill credentials", err as Error, {
      configPath: openclawConfigPath,
      skillKey: YINTAI_TASKS_RUNNER_SKILL_KEY,
    });
  }
}

/**
 * Global WebSocket connection storage
 * Maps accountId to WebSocket instance for outbound message sending
 */
const activeConnections = new Map<string, any>();

/**
 * Send response to server request through WebSocket connection
 * 
 * IMPORTANT: This function is used to RESPOND to server requests, not to actively
 * initiate messages. The plugin acts as a request responder in the Open Responses
 * protocol - the server sends requests, and the plugin responds with event sequences.
 * 
 * This function implements the outbound.sendText method by:
 * 1. Converting response text to Open Responses event sequence (using protocol.ts)
 * 2. Wrapping each event in a WebSocket Envelope (using protocol.ts)
 * 3. Sending each envelope through the WebSocket connection
 * 
 * Protocol Flow:
 * - Server sends request → Plugin receives → Plugin generates response events → Plugin sends
 * - Each response event is independently wrapped in an Envelope and sent
 * - All protocol operations use unified functions from protocol.ts module
 * 
 * Validates: Requirements 2.2, 2.5, 8.1, 8.2, 8.3, 8.4, 8.5
 * 
 * @param cfg - Plugin configuration from OpenClaw
 * @param to - Target identifier (recipient)
 * @param text - Response text content to send
 * @param accountId - Account identifier
 * @throws {Error} If WebSocket is not connected
 */
async function sendTextMessage(
  cfg: any,
  to: string,
  text: string,
  accountId?: string
): Promise<void> {
  const account = resolveInstaClawAccount(cfg, accountId);
  const config = account.config;
  const logger = new DebugLogger(Boolean(config?.['debug']), `[InstaClaw:outbound]`);

  // Validate configuration
  if (!account.enabled) {
    const error = new Error('InstaClaw connector is not enabled');
    logger.error('Cannot send message: connector disabled', error);
    throw error;
  }
  
  if (!text || text.trim() === '') {
    const error = new Error('Cannot send empty message');
    logger.error('Invalid message text', error, { to, accountId });
    throw error;
  }
  
  logger.debug('Sending text message', {
    to,
    textLength: text.length,
    accountId,
  });
  
  // Get WebSocket connection for this account
  const wsKey = accountId || 'default';
  const ws = activeConnections.get(wsKey);
  
  if (!ws) {
    const error = new Error('WebSocket connection not found for account');
    logger.error('Cannot send message', error, {
      accountId: wsKey,
      availableConnections: Array.from(activeConnections.keys()),
    });
    throw error;
  }
  
  if (ws.readyState !== 1) { // 1 = OPEN
    const error = new Error(`WebSocket is not connected (state: ${ws.readyState})`);
    logger.error('Cannot send message', error, {
      accountId: wsKey,
      wsState: ws.readyState,
      wsStateDescription: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState] || 'UNKNOWN', 
    });
    throw error;
  }
  
  try {
    // Use unified protocol functions from protocol.ts to generate response
    // This ensures all protocol operations are centralized and consistent
    const events = textToEventSequence(text);
    
    logger.debug('Generated response event sequence', {
      eventCount: events.length,
      responseType: 'text',
    });
    
    // Send each event wrapped in an envelope using unified protocol functions
    // Each event is independently wrapped and sent as per Open Responses protocol
    for (const event of events) {
      const envelope = createEnvelope(event);
      ws.send(envelope);
      
      logger.debug('Sent response event', {
        type: event.type,
        response_id: event.response_id,
      });
    }
    
    logger.info('Response sent successfully', {
      to,
      textLength: text.length,
      eventCount: events.length,
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to send response', err, {
      to,
      accountId: wsKey,
      textLength: text.length,
      errorName: err.name,
      errorMessage: err.message,
    });
    throw error;
  }
}

/**
 * InstaClaw Channel Plugin
 * 
 * This object implements the ChannelPlugin interface for OpenClaw,
 * defining the plugin's metadata, capabilities, configuration schema,
 * and gateway/outbound methods.
 * 
 * Validates: Requirements 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4,
 *            4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5
 */
export const instaClawPlugin: ChannelPlugin = {
  /**
   * Plugin identifier
   * Must match meta.id for consistency
   * 
   * Validates: Requirements 2.3
   */
  id: "insta-claw-connector",
  
  /**
   * Plugin metadata
   * Displayed in OpenClaw UI
   * 
   * Validates: Requirements 2.1, 2.2, 2.3
   */
  meta: {
    id: "insta-claw-connector",
    label: "InstaClaw",
    selectionLabel: "InstaClaw",
    docsPath: "/channels/instaclaw",
    blurb: "InstaClaw WebSocket connector for bidirectional messaging with Open Responses protocol support",
  },
  
  /**
   * Channel capabilities declaration
   * Defines what features this channel supports
   * 
   * MVP scope: only direct chat with text messages
   * 
   * Validates: Requirements 3.1, 3.2, 3.3, 3.4
   */
  capabilities: {
    chatTypes: ["direct"],
    media: false,
    polls: false,
    threads: false,
    reactions: false,
    edit: false,
    reply: false,
  },
  
  /**
   * Configuration schema
   * Defines the structure and UI hints for plugin configuration
   * 
   * Validates: Requirements 4.1, 4.2, 4.3, 4.4
   */
  configSchema: {
    schema: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          default: true,
        },
        clientId: {
          type: "string",
        },
        clientSecret: {
          type: "string",
        },
        systemPrompt: {
          type: "string",
        },
      },
    },
    uiHints: {
      enabled: {
        label: "Enable InstaClaw Connector",
      },
      clientId: {
        label: "Client ID (x-app-key)",
      },
      clientSecret: {
        label: "Client Secret (x-app-secret)",
        sensitive: true,
      },
      systemPrompt: {
        label: "System Prompt",
      },
    },
  },
  
  /**
   * Config adapter (required)
   * Manages account resolution and configuration
   */
  config: {
    listAccountIds: (cfg) => listInstaClawAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveInstaClawAccount(cfg, accountId),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const isDefault = accountId === DEFAULT_ACCOUNT_ID;
      if (isDefault) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            [CHANNEL_ID]: {
              ...cfg.channels?.[CHANNEL_ID],
              enabled,
            },
          },
        };
      }
      const channelCfg = cfg.channels?.[CHANNEL_ID] ?? {};
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          [CHANNEL_ID]: {
            ...channelCfg,
            accounts: {
              ...channelCfg.accounts,
              [accountId]: {
                ...channelCfg.accounts?.[accountId],
                enabled,
              },
            },
          },
        },
      };
    },
    deleteAccount: ({ cfg, accountId }) => {
      if (accountId === DEFAULT_ACCOUNT_ID) {
        const next = { ...cfg };
        const nextChannels = { ...cfg.channels };
        delete nextChannels[CHANNEL_ID];
        next.channels = Object.keys(nextChannels).length > 0 ? nextChannels : undefined;
        return next;
      }
      const channelCfg = cfg.channels?.[CHANNEL_ID] ?? {};
      const accounts = { ...channelCfg.accounts };
      delete accounts[accountId];
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          [CHANNEL_ID]: {
            ...channelCfg,
            accounts: Object.keys(accounts).length > 0 ? accounts : undefined,
          },
        },
      };
    },
    isConfigured: (account) => (account as ResolvedInstaClawAccount).configured,
    describeAccount: (account) => {
      const a = account as ResolvedInstaClawAccount;
      return {
        accountId: a.accountId,
        enabled: a.enabled,
        configured: a.configured,
        name: a.name,
        clientId: a.clientId,
      };
    },
  },

  /**
   * Gateway methods
   * Manages the connection lifecycle
   */
  gateway: {
    /**
     * Start account connection
     * 
     * This method is called by OpenClaw Gateway to start the WebSocket connection
     * for a specific account. It delegates to the Provider Monitor function which
     * manages the complete connection lifecycle.
     * 
     * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
     * 
     * @param ctx - Account context containing cfg, accountId, and abortSignal
     * @returns Promise that resolves when connection is closed or aborted
     */
    startAccount: async (ctx) => {
      const { cfg, accountId, abortSignal } = ctx;
      const account = resolveInstaClawAccount(cfg, accountId);

      if (!account.enabled) {
        ctx.log?.info?.(`insta-claw-connector[${accountId}] is disabled, skipping startup`);
        return new Promise<void>((resolve) => {
          if (ctx.abortSignal?.aborted) {
            resolve();
            return;
          }
          ctx.abortSignal?.addEventListener('abort', () => resolve(), { once: true });
        });
      }

      if (!account.configured) {
        throw new Error(`InstaClaw account "${accountId}" is not properly configured (missing clientId/clientSecret)`);
      }

      const connectorCfg = account.config;
      const logger = new DebugLogger(Boolean(connectorCfg?.['debug']), `[InstaClaw:startAccount]`);
      syncSkillCredentials(account, logger);
      logger.debug("Using resolved account configuration for gateway startup", {
        accountId: account.accountId,
        hasClientId: Boolean(account.clientId),
        hasClientSecret: Boolean(account.clientSecret),
      });

      // Store connection reference for outbound messages
      // This will be populated by the Provider Monitor
      const wsKey = accountId || 'default';

      // Start the Provider Monitor
      // This function will establish the WebSocket connection, handle reconnection,
      // process inbound messages, and maintain the connection until abort
      // Pass channelRuntime (if available) for real AI dispatch via SDK
      await monitorInstaClawProvider(cfg, accountId, abortSignal, ctx.channelRuntime);

      // Clean up connection reference when monitor stops
      activeConnections.delete(wsKey);
    },
  },
  
  /**
   * Outbound methods
   * Handles sending response messages from OpenClaw to the remote server
   * 
   * IMPORTANT: These methods are used to RESPOND to server requests, not to
   * actively initiate messages. The plugin acts as a request responder.
   */
  outbound: {
    deliveryMode: 'gateway' as const,
    /**
     * Send text response to server request
     *
     * This method is called by OpenClaw to send a text response back to the server.
     * The plugin acts as a request responder - it receives requests from the server
     * and sends back Open Responses event sequences as responses.
     *
     * Protocol Flow:
     * 1. Server sends request to plugin
     * 2. OpenClaw processes request and generates response text
     * 3. This method converts response text to Open Responses event sequence
     * 4. Each event is wrapped in WebSocket Envelope and sent to server
     *
     * Validates: Requirements 2.2, 2.5, 8.1, 8.2, 8.3, 8.4, 8.5
     *
     * @param ctx - Outbound context (cfg, to, text, accountId)
     * @returns Promise with delivery result
     */
    sendText: async (ctx) => {
      await sendTextMessage(ctx.cfg, ctx.to, ctx.text, ctx.accountId ?? undefined);
      return {
        channel: CHANNEL_ID,
        messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      };
    },
  },
};

/**
 * Export function to store WebSocket connection reference
 * Called by connection.ts when WebSocket is established
 * 
 * @param accountId - Account identifier
 * @param ws - WebSocket instance
 */
export function registerConnection(accountId: string, ws: any): void {
  const wsKey = accountId || 'default';
  activeConnections.set(wsKey, ws);
}

/**
 * Export function to remove WebSocket connection reference
 * Called by connection.ts when WebSocket is closed
 * 
 * @param accountId - Account identifier
 */
export function unregisterConnection(accountId: string): void {
  const wsKey = accountId || 'default';
  activeConnections.delete(wsKey);
}
