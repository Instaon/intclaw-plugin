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
import { monitorInstaClawProvider } from "./connection";
import { createEnvelope, textToEventSequence } from "./protocol";
import { DebugLogger } from "./logger";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const CHANNEL_ID = "insta-claw-connector" as const;

/**
 * Resolved account type for InstaClaw connector
 */
interface ResolvedInstaClawAccount {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
  clientId?: string;
  clientSecret?: string;
  systemPrompt?: string;
  config: Record<string, unknown>;
}

/**
 * List all InstaClaw account IDs.
 * Currently supports only the default account.
 */
function listInstaClawAccountIds(cfg: any): string[] {
  const accounts = cfg.channels?.[CHANNEL_ID]?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [DEFAULT_ACCOUNT_ID];
  }
  const ids = Object.keys(accounts).filter(Boolean);
  return ids.length > 0 ? [...ids].sort() : [DEFAULT_ACCOUNT_ID];
}

/**
 * Resolve a complete InstaClaw account with merged config.
 */
function resolveInstaClawAccount(cfg: any, accountId?: string | null): ResolvedInstaClawAccount {
  const hasExplicitAccountId = typeof accountId === "string" && accountId.trim() !== "";
  const resolvedAccountId = hasExplicitAccountId ? accountId! : DEFAULT_ACCOUNT_ID;
  const channelCfg = cfg.channels?.[CHANNEL_ID] ?? {};

  // For named accounts, merge with base config
  let merged = { ...channelCfg };
  if (hasExplicitAccountId && channelCfg.accounts?.[resolvedAccountId]) {
    const { accounts: _ignored, defaultAccount: _ignoredDefault, ...base } = channelCfg;
    merged = { ...base, ...channelCfg.accounts[resolvedAccountId] };
  }

  const enabled = merged.enabled !== false;
  const clientId = typeof merged.clientId === "string" ? merged.clientId.trim() || undefined : undefined;
  const clientSecret = typeof merged.clientSecret === "string" ? merged.clientSecret.trim() || undefined : undefined;

  return {
    accountId: resolvedAccountId,
    enabled,
    configured: Boolean(clientId && clientSecret),
    name: typeof merged.name === "string" ? merged.name.trim() || undefined : undefined,
    clientId,
    clientSecret,
    systemPrompt: typeof merged.systemPrompt === "string" ? merged.systemPrompt.trim() || undefined : undefined,
    config: merged,
  };
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
  const logger = new DebugLogger(config?.['debug'] ?? false, `[InstaClaw:outbound]`);

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

      // --- Write clientId/clientSecret to openclaw config for yintai_tasks_runner skill ---
      const connectorCfg = account.config;
      const logger = new DebugLogger(connectorCfg?.['debug'] ?? false, `[InstaClaw:startAccount]`);

      if (account.clientId && account.clientSecret) {
        const openclawConfigPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
        try {
          let openclawConfig: any = {};
          if (fs.existsSync(openclawConfigPath)) {
            const raw = fs.readFileSync(openclawConfigPath, "utf-8");
            openclawConfig = JSON.parse(raw);
          }

          const skillEntry = openclawConfig?.skills?.entries?.yintai_tasks_runner;
          // Only write if the skill is not yet configured
          if (!skillEntry) {
            if (!openclawConfig.skills) openclawConfig.skills = {};
            if (!openclawConfig.skills.entries) openclawConfig.skills.entries = {};

            openclawConfig.skills.entries.yintai_tasks_runner = {
              enabled: true,
              apiKey: String(account.clientId),
              env: {
                YINTAI_APP_SECRET: String(account.clientSecret),
              },
            };

            // Ensure the directory exists
            const openclawDir = path.dirname(openclawConfigPath);
            if (!fs.existsSync(openclawDir)) {
              fs.mkdirSync(openclawDir, { recursive: true });
            }

            fs.writeFileSync(openclawConfigPath, JSON.stringify(openclawConfig, null, 2), "utf-8");
            logger.info("Wrote yintai_tasks_runner skill config to openclaw.json", {
              configPath: openclawConfigPath,
              apiKeyLength: String(account.clientId).length,
            });
          } else {
            logger.debug("yintai_tasks_runner skill already configured, skipping write");
          }
        } catch (err) {
          logger.error("Failed to write openclaw config", err as Error, {
            configPath: openclawConfigPath,
          });
          // Non-fatal: continue with WebSocket connection
        }
      }

      // Store connection reference for outbound messages
      // This will be populated by the Provider Monitor
      const wsKey = accountId || 'default';

      // Start the Provider Monitor
      // This function will establish the WebSocket connection, handle reconnection,
      // process inbound messages, and maintain the connection until abort
      await monitorInstaClawProvider(cfg, accountId, abortSignal);

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
     * @param cfg - Plugin configuration
     * @param to - Target identifier (recipient)
     * @param text - Response text content
     * @param accountId - Account identifier
     * @returns Promise that resolves when response is sent
     */
    sendText: async (cfg, to, text, accountId) => {
      await sendTextMessage(cfg, to, text, accountId);
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
