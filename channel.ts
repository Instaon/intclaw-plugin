/**
 * Channel Plugin Module
 * 
 * This module defines the ChannelPlugin object that integrates with OpenClaw,
 * including metadata, capabilities, configuration schema, and gateway/outbound methods.
 * 
 * Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4,
 *            5.1, 5.2, 5.3, 5.4, 5.5, 8.1, 8.2, 8.3, 8.4, 8.5, 1.3
 */

import type { ChannelPlugin } from "openclaw/plugin-sdk";
import { monitorInstaClawProvider } from "./connection.js";
import { createEnvelope, textToEventSequence } from "./protocol.js";
import { DebugLogger } from "./logger.js";
import { WS_URL } from "./config.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Global WebSocket connection storage
 * Maps accountId to WebSocket instance for outbound message sending
 */
const activeConnections = new Map<string, any>();

/**
 * Send text message through WebSocket connection
 * 
 * This function implements the outbound.sendText method, converting text messages
 * to Open Responses event sequences and sending them through the WebSocket connection.
 * 
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 * 
 * @param cfg - Plugin configuration from OpenClaw
 * @param to - Target identifier (recipient)
 * @param text - Message text content
 * @param accountId - Account identifier
 * @throws {Error} If WebSocket is not connected
 */
async function sendTextMessage(
  cfg: any,
  to: string,
  text: string,
  accountId?: string
): Promise<void> {
  const config = cfg.channels?.["insta-claw-connector"];
  const logger = new DebugLogger(config?.debug ?? false, `[InstaClaw:outbound]`);
  
  // Validate configuration
  if (!config?.enabled) {
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
    // Convert text to Open Responses event sequence
    const events = textToEventSequence(text);
    
    logger.debug('Generated event sequence', {
      eventCount: events.length,
    });
    
    // Send each event wrapped in an envelope
    for (const event of events) {
      const envelope = createEnvelope(event);
      ws.send(envelope);
      
      logger.debug('Sent event', {
        type: event.type,
        response_id: event.response_id,
      });
    }
    
    logger.info('Text message sent successfully', {
      to,
      textLength: text.length,
      eventCount: events.length,
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to send text message', err, {
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

      // --- Write clientId/clientSecret to openclaw config for yintai_tasks_runner skill ---
      const connectorCfg = cfg.channels?.["insta-claw-connector"];
      const logger = new DebugLogger(connectorCfg?.debug ?? false, `[InstaClaw:startAccount]`);

      if (connectorCfg?.clientId && connectorCfg?.clientSecret) {
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
              apiKey: String(connectorCfg.clientId),
              env: {
                YINTAI_APP_SECRET: String(connectorCfg.clientSecret),
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
              apiKeyLength: String(connectorCfg.clientId).length,
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
   * Handles sending messages from OpenClaw to the remote server
   */
  outbound: {
    /**
     * Send text message
     * 
     * This method is called by OpenClaw to send a text message to the remote server.
     * It converts the text to Open Responses event sequence and sends through WebSocket.
     * 
     * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
     * 
     * @param cfg - Plugin configuration
     * @param to - Target identifier (recipient)
     * @param text - Message text content
     * @param accountId - Account identifier
     * @returns Promise that resolves when message is sent
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
