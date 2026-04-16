/**
 * WebSocket Connection Manager
 * 
 * This module manages the WebSocket connection lifecycle for the Instagram Claw Connector,
 * including connection establishment, heartbeat mechanism, reconnection strategy, and error handling.
 * 
 * Validates: Requirements 13.1, 9.2, 2.1, 2.2, 2.4, 2.5, 9.4, 8.1-8.6, 9.1-9.6, 2.3, 7.4, 11.1, 11.6
 */

import WebSocket from 'ws';
import { resolveInstaClawAccount } from './account-config';
import type { 
  ConnectionConfig, 
  ConnectionState, 
  Response,
  OutputItemAddedEvent,
  OutputTextDeltaEvent,
  ResponseCompletedEvent,
  ResponseFailedEvent,
} from './types';
import type { DebugLogger } from './logger';

/**
 * WebSocket Connection Manager Class
 * 
 * Manages the complete lifecycle of a WebSocket connection including:
 * - Connection establishment with authentication headers
 * - Heartbeat mechanism with ping/pong
 * - Automatic reconnection with exponential backoff
 * - Connection state management
 * - Error handling and recovery
 * 
 * Validates: Requirements 13.1, 9.2
 */
export class WebSocketConnection {
  /** WebSocket instance */
  private ws: WebSocket | null = null;
  
  /** Current connection state */
  private state: ConnectionState = 'disconnected';
  
  /** Number of reconnection attempts */
  private reconnectAttempts: number = 0;
  
  /** Heartbeat timer */
  private heartbeatTimer: NodeJS.Timeout | null = null;
  
  /** Last time a pong was received */
  private lastPongTime: number = 0;
  
  /** Whether the connection is intentionally stopped */
  private isStopped: boolean = false;
  
  /** Whether a reconnection is in progress */
  private isReconnecting: boolean = false;

  /**
   * Creates a new WebSocketConnection instance
   * 
   * @param config - Connection configuration
   * @param logger - Debug logger instance
   * @param onMessage - Callback for incoming messages
   * @param onStateChange - Callback for connection state changes
   */
  constructor(
    private config: ConnectionConfig,
    private logger: DebugLogger,
    private onMessage: (data: string) => void,
    private onStateChange: (state: ConnectionState) => void
  ) {
    this.logger.debug('WebSocketConnection initialized', {
      wsUrl: config.wsUrl,
      heartbeatInterval: config.heartbeatInterval,
    });
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Establish WebSocket connection
   * 
   * Validates: Requirements 2.1, 2.2, 2.4, 2.5, 9.4
   * 
   * @param accountId - Optional account identifier for connection registration
   * @throws {Error} If connection fails
   */
  async connect(accountId?: string): Promise<void> {
    // Check if enabled and credentials are configured
    if (!this.config.enabled) {
      this.logger.warn('Connection disabled, skipping connect', {
        reason: this.config.enabled === false
          ? 'enabled is explicitly set to false'
          : 'enabled field is missing or falsy',
        enabled: this.config.enabled,
        wsUrl: this.config.wsUrl,
      });
      return;
    }

    if (!this.config.clientId || this.config.clientId.trim() === '') {
      this.logger.warn('clientId not configured, skipping connect', {
        hasClientId: !!this.config.clientId,
        clientIdType: typeof this.config.clientId,
      });
      return;
    }

    if (!this.config.clientSecret || this.config.clientSecret.trim() === '') {
      this.logger.warn('clientSecret not configured, skipping connect', {
        hasClientSecret: !!this.config.clientSecret,
        clientSecretType: typeof this.config.clientSecret,
      });
      return;
    }

    // Update state
    this.updateState('connecting');
    this.logger.info('Establishing WebSocket connection', {
      url: this.config.wsUrl,
    });

    try {
      // Create WebSocket with authentication headers
      this.ws = new WebSocket(this.config.wsUrl, {
        headers: {
          'x-app-key': this.config.clientId,
          'x-app-secret': this.config.clientSecret,
        },
      });

      // Set up event listeners
      this.setupEventListeners();

      // Wait for connection to open
      await this.waitForConnection();

      // Connection successful
      this.updateState('connected');
      this.logger.info('WebSocket connection established successfully');

      // Reset reconnection attempts on successful connection
      this.reconnectAttempts = 0;

      // Register connection for outbound messages
      if (accountId) {
        const { registerConnection } = await import('./channel.js');
        registerConnection(accountId, this.ws);
        this.logger.debug('Registered WebSocket connection', { accountId });
      }

      // Start heartbeat mechanism
      this.startHeartbeat();
    } catch (error) {
      const err = error as Error;
      const wsError = err as any;
      this.logger.error('Failed to establish WebSocket connection', err, {
        url: this.config.wsUrl,
        attempt: this.reconnectAttempts,
        errorCode: wsError.code,
        errorMessage: err.message,
        errorName: err.name,
        // Network-level diagnostics
        syscall: wsError.syscall,
        hostname: wsError.hostname,
        osError: wsError.osError,
      });

      // Trigger reconnection
      this.handleReconnect();
      throw error;
    }
  }

  /**
   * Wait for WebSocket connection to open
   * 
   * @returns Promise that resolves when connection opens or rejects on error
   * @private
   */
  private waitForConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket instance not created'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000); // 10 second timeout

      this.ws.once('open', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.ws.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Set up WebSocket event listeners
   * 
   * @private
   */
  private setupEventListeners(): void {
    if (!this.ws) return;

    // Open event
    this.ws.on('open', () => {
      this.logger.debug('WebSocket opened');
    });

    // Message event
    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = data.toString();
        this.logger.info('Received WebSocket message', {
          length: message.length,
          data: message,
        });
        this.onMessage(message);
      } catch (error) {
        this.logger.error('Error processing WebSocket message', error as Error, {
          messageLength: data.toString().length,
          messagePreview: data.toString().substring(0, 100),
        });
      }
    });

    // Pong event (heartbeat response)
    this.ws.on('pong', () => {
      this.lastPongTime = Date.now();
    });

    // Close event
    this.ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason.toString();
      this.logger.info('WebSocket closed', {
        code,
        reason: reasonStr,
        timestamp: Date.now(),
        wasIntentional: this.isStopped,
      });

      // Stop heartbeat
      this.stopHeartbeat();

      // Update state
      this.updateState('disconnected');

      // Trigger reconnection if not intentionally stopped
      if (!this.isStopped) {
        this.logger.info('Connection closed unexpectedly, will attempt reconnection', {
          code,
          reason: reasonStr,
        });
        this.handleReconnect();
      }
    });

    // Error event
    this.ws.on('error', (error: Error) => {
      this.logger.error('WebSocket error', error, {
        state: this.state,
        readyState: this.ws?.readyState,
        errorCode: (error as any).code,
        errorMessage: error.message,
        syscall: (error as any).syscall,
        timestamp: Date.now(),
      });
    });
  }

  /**
   * Disconnect WebSocket connection
   * 
   * Validates: Requirements 7.4, 9.6
   * 
   * @param accountId - Optional account identifier for connection unregistration
   */
  async disconnect(accountId?: string): Promise<void> {
    this.logger.info('Disconnecting WebSocket');

    // Mark as intentionally stopped
    this.isStopped = true;

    // Unregister connection for outbound messages
    if (accountId) {
      try {
        const { unregisterConnection } = await import('./channel.js');
        unregisterConnection(accountId);
        this.logger.debug('Unregistered WebSocket connection', { accountId });
      } catch (error) {
        this.logger.warn('Failed to unregister connection', {
          accountId,
          error: (error as Error).message,
        });
      }
    }

    // Stop heartbeat
    this.stopHeartbeat();

    // Close WebSocket
    if (this.ws) {
      // Remove all event listeners
      this.ws.removeAllListeners();

      // Close connection
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }

      this.ws = null;
    }

    // Update state
    this.updateState('disconnected');

    this.logger.info('WebSocket disconnected');
  }

  // ============================================================================
  // Heartbeat Mechanism
  // ============================================================================

  /**
   * Start heartbeat mechanism
   * 
   * Sends ping packets at regular intervals and monitors for pong responses.
   * If no pong is received within 3x the heartbeat interval, triggers reconnection.
   * 
   * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
   * 
   * @private
   */
  private startHeartbeat(): void {
    // Stop any existing heartbeat
    this.stopHeartbeat();

    // Initialize last pong time
    this.lastPongTime = Date.now();

    this.logger.debug('Starting heartbeat mechanism', {
      interval: this.config.heartbeatInterval,
      timeout: this.config.heartbeatInterval * 3,
    });

    // Set up heartbeat timer
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.logger.warn('WebSocket not open, skipping heartbeat');
        return;
      }

      // Check for heartbeat timeout
      const timeSinceLastPong = Date.now() - this.lastPongTime;
      const timeoutThreshold = this.config.heartbeatInterval * 3;

      if (timeSinceLastPong > timeoutThreshold) {
        this.logger.warn('Heartbeat timeout detected, triggering reconnection', {
          timeSinceLastPong,
          threshold: timeoutThreshold,
          lastPongTime: this.lastPongTime,
          currentTime: Date.now(),
        });

        // Stop heartbeat and trigger reconnection
        this.stopHeartbeat();
        this.handleReconnect();
        return;
      }

      try {
        this.ws.ping();
      } catch (error) {
        this.logger.error('Failed to send ping, connection may be broken', error as Error, {
          wsState: this.ws?.readyState,
          connectionState: this.state,
        });
        // Trigger reconnection if ping fails
        this.stopHeartbeat();
        this.handleReconnect();
      }
    }, this.config.heartbeatInterval);

    this.logger.debug('Heartbeat mechanism started');
  }

  /**
   * Stop heartbeat mechanism
   * 
   * @private
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.logger.debug('Heartbeat mechanism stopped');
    }
  }

  // ============================================================================
  // Reconnection Strategy
  // ============================================================================

  /**
   * Handle reconnection with exponential backoff
   * 
   * Implements exponential backoff strategy with random jitter:
   * delay = min(1000 * 2^attempt, 30000) + random(0, 1000)
   * 
   * Validates: Requirements 9.1, 9.2, 9.3, 9.5, 9.6, 2.3
   * 
   * @private
   */
  private async handleReconnect(): Promise<void> {
    // Check if already reconnecting or stopped
    if (this.isReconnecting || this.isStopped) {
      this.logger.debug('Reconnection already in progress or stopped, skipping');
      return;
    }

    // Check if enabled
    if (!this.config.enabled) {
      this.logger.info('Connection disabled, stopping reconnection');
      return;
    }

    // Check max reconnection attempts
    if (
      this.config.reconnectMaxAttempts !== undefined &&
      this.config.reconnectMaxAttempts > 0 &&
      this.reconnectAttempts >= this.config.reconnectMaxAttempts
    ) {
      this.logger.warn('Max reconnection attempts reached', {
        attempts: this.reconnectAttempts,
        max: this.config.reconnectMaxAttempts,
      });
      return;
    }

    this.isReconnecting = true;
    this.updateState('reconnecting');

    // Calculate exponential backoff delay
    const exponentialDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    const jitter = Math.random() * 1000;
    const delay = exponentialDelay + jitter;

    this.reconnectAttempts++;

    this.logger.info('Scheduling reconnection', {
      attempt: this.reconnectAttempts,
      delay: Math.round(delay),
    });

    // Wait for backoff delay
    await new Promise(resolve => setTimeout(resolve, delay));

    // Clean up old connection
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }

    this.isReconnecting = false;

    // Attempt to reconnect
    try {
      await this.connect();
    } catch (error) {
      const err = error as Error;
      const wsError = err as any;
      this.logger.error('Reconnection attempt failed', err, {
        attempt: this.reconnectAttempts,
        errorCode: wsError.code,
        errorMessage: err.message,
        syscall: wsError.syscall,
        willRetry: !this.isStopped,
      });
      // connect() will trigger another reconnection attempt
    }
  }

  // ============================================================================
  // Message Sending
  // ============================================================================

  /**
   * Send a message through the WebSocket connection
   * 
   * Validates: Requirements 7.4
   * 
   * @param data - Message data to send
   * @throws {Error} If connection is not open
   */
  send(data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const error = new Error('WebSocket is not connected');
      this.logger.error('Cannot send message', error, {
        state: this.state,
        readyState: this.ws?.readyState,
      });
      throw error;
    }

    try {
      this.ws.send(data);
      this.logger.info('Sent WebSocket message', {
        length: data.length,
        data,
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error('Failed to send WebSocket message', err, {
        dataLength: data.length,
        wsState: this.ws?.readyState,
        connectionState: this.state,
        errorCode: (err as any).code,
      });
      throw error;
    }
  }

  // ============================================================================
  // State Management
  // ============================================================================

  /**
   * Update connection state and notify listeners
   * 
   * @param newState - New connection state
   * @private
   */
  private updateState(newState: ConnectionState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;

      this.logger.info('Connection state changed', {
        from: oldState,
        to: newState,
      });

      // Notify state change listener
      this.onStateChange(newState);
    }
  }

  /**
   * Get current connection state
   * 
   * @returns Current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Check if connection is currently connected
   * 
   * @returns True if connected, false otherwise
   */
  isConnected(): boolean {
    return this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get the underlying WebSocket instance
   * 
   * @returns WebSocket instance or null if not connected
   */
  getWebSocket(): WebSocket | null {
    return this.ws;
  }
}

// ============================================================================
// Provider Monitor Function
// ============================================================================

/**
 * Monitor InstaClaw Provider
 * 
 * Main entry point for managing the WebSocket connection lifecycle and message handling.
 * This function:
 * - Validates configuration
 * - Establishes WebSocket connection
 * - Processes incoming Open Responses events
 * - Maintains connection state and handles reconnection
 * - Cleans up resources on abort
 * 
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.5, 9.1-9.7, 13.1-13.4, 14.1-14.5, 16.1-16.6, 19.1-19.2
 * 
 * @param cfg - Plugin configuration from OpenClaw
 * @param accountId - Account identifier
 * @param abortSignal - Signal to abort the connection
 * @param channelRuntime - Optional channel runtime for AI dispatch via SDK
 * @returns Promise that resolves when connection is closed or aborted
 */
export async function monitorInstaClawProvider(
  cfg: any,
  accountId: string,
  abortSignal: AbortSignal,
  channelRuntime?: any
): Promise<void> {
  // Import dependencies
  const { parseEnvelope } = await import('./protocol.js');
  const { DebugLogger } = await import('./logger.js');
  const { WS_URL, HEARTBEAT_INTERVAL, MAX_RECONNECT_ATTEMPTS, SDK_REQUEST_TIMEOUT, MAX_CONCURRENT_REQUESTS } = await import('./config.js');
  const { SDKDispatcher } = await import('./sdk-dispatcher.js');
  
  // Extract plugin configuration
  const account = resolveInstaClawAccount(cfg, accountId);
  const config = account.config;

  // Initialize logger early for configuration diagnostics
  const debugEnabled = config["debug"] === true;
  const logger = new DebugLogger(debugEnabled, `[InstaClaw:${accountId}]`);

  logger.info('Resolved configuration', {
    hasConfig: !!config,
    enabled: account.enabled,
    hasClientId: !!account.clientId,
    clientIdLength: account.clientId?.length ?? 0,
    hasClientSecret: !!account.clientSecret,
    wsUrl: WS_URL,
  });

  // Validate configuration: enabled defaults to true when field is absent
  if (!account.enabled) {
    const error = new Error("InstaClaw connector is not enabled in configuration");
    throw error;
  }

  if (!config) {
    const error = new Error("No configuration found for insta-claw-connector channel");
    throw error;
  }

  if (!account.clientId || account.clientId.trim() === '') {
    const error = new Error("Missing required configuration: clientId must be provided and non-empty");
    throw error;
  }

  if (!account.clientSecret || account.clientSecret.trim() === '') {
    const error = new Error("Missing required configuration: clientSecret must be provided and non-empty");
    throw error;
  }

  logger.info('Starting InstaClaw provider monitor', {
    accountId,
    wsUrl: WS_URL,
  });
  
  // Response state management
  const activeResponses = new Map<string, Response>();
  
  // Create SDK dispatcher instance
  // Pass cfg and channelRuntime so the dispatcher can call the real AI SDK
  const dispatcher = new SDKDispatcher(
    {
      requestTimeout: SDK_REQUEST_TIMEOUT,
      maxConcurrentRequests: MAX_CONCURRENT_REQUESTS,
      debug: debugEnabled,
      cfg,
    },
    logger,
    accountId,
    channelRuntime
  );
  
  /**
   * Handle incoming messages.
   *
   * Per open-responses.md §9, all frames share the same Envelope shape:
   *   { type: "MESSAGE", headers: { messageId, topic }, data: "<json string>" }
   *
   * Routing is determined by headers.topic:
   *   - "/v1.0/im/user/messages"  → inbound user message; plugin responds with event sequence
   *   - "/v1.0/im/bot/messages"   → inbound Open Responses event (server relay / monitoring)
   *
   * Validates: Requirements 2.1, 2.2, 2.4, 2.5, 9.1-9.7, 16.1-16.6, 18.1
   */
  async function handleMessage(rawMessage: string): Promise<void> {
    try {
      // Import protocol helpers
      const {
        parseRequest,
        parseEnvelope,
        TOPIC_USER_MESSAGES,
      } = await import('./protocol.js');

      // Peek at the Envelope to read the topic and type for routing
      let topic: string | undefined;
      let envelopeType: string | undefined;
      try {
        const peek = JSON.parse(rawMessage);
        
        // Check if it's a standard request without envelope (open-responses.md format)
        if (peek && typeof peek === 'object' && Array.isArray(peek.input) && peek.metadata && !peek.headers) {
          topic = TOPIC_USER_MESSAGES;
        } else {
          topic = peek?.headers?.topic;
          envelopeType = peek?.type;
        }
      } catch (parseError) {
        // Parse error handling (Requirement 2.4, 18.1)
        // Log parse errors without crashing, continue processing other messages
        logger.error('Failed to parse WebSocket message envelope', parseError as Error, {
          message_preview: rawMessage.substring(0, 100),
          message_length: rawMessage.length,
          error_name: (parseError as Error).name,
          error_message: (parseError as Error).message,
        });
        // Continue operation - don't crash (Requirement 18.1)
        return;
      }

      // ── Inbound user message (plugin acts as responder) ──────────────
      if (topic === TOPIC_USER_MESSAGES) {
        logger.debug('Received user message (topic: user/messages)');

        let request;
        try {
          request = parseRequest(rawMessage);
        } catch (parseError) {
          // Parse error handling (Requirement 2.4, 18.1)
          // Log parse errors without crashing, continue processing other messages
          logger.error('Failed to parse user request', parseError as Error, {
            message_preview: rawMessage.substring(0, 100),
            message_length: rawMessage.length,
            error_name: (parseError as Error).name,
            error_message: (parseError as Error).message,
          });
          // Continue operation - don't crash (Requirement 18.1)
          return;
        }

        logger.info('Parsed user request', {
          messageId: request.messageId,
          topic: request.topic,
          sessionId: request.sessionId,
          contentLength: request.content.length,
        });

        // Dispatch to SDK (replaces the echo logic)
        // The dispatcher will handle the request and send response events via WebSocket
        const ws = connection.getWebSocket();
        if (ws) {
          await dispatcher.dispatchRequest(request, ws);
        } else {
          logger.error('Cannot dispatch request: WebSocket not available', undefined, {
            messageId: request.messageId,
            connectionState: connection.getState(),
          });
        }
        
        return;
      }
      
      // Skip non-MESSAGE envelope types (e.g. session.auto_bound, system events)
      if (envelopeType !== undefined && envelopeType !== 'MESSAGE') {
        logger.info('Ignoring non-MESSAGE WebSocket event', {
          type: envelopeType,
          message_length: rawMessage.length,
        });
        return;
      }

      // Handle incoming Open Responses events (existing logic)
      let event;
      try {
        event = parseEnvelope(rawMessage);
      } catch (parseError) {
        // Parse error handling (Requirement 2.4, 18.1)
        // Log parse errors without crashing, continue processing other messages
        logger.error('Failed to parse Open Responses event', parseError as Error, {
          message_preview: rawMessage.substring(0, 100),
          message_length: rawMessage.length,
          error_name: (parseError as Error).name,
          error_message: (parseError as Error).message,
        });
        // Continue operation - don't crash (Requirement 18.1)
        return;
      }
      
      logger.debug('Received Open Responses event', {
        type: event.type,
        response_id: event.response_id,
      });
      
      // Handle different event types
      switch (event.type) {
        case 'response.in_progress': {
          // Create new response state
          activeResponses.set(event.response_id, {
            id: event.response_id,
            status: 'in_progress',
            output: { items: [] },
            error: null,
            metadata: {},
          });
          logger.debug('Created response state', { response_id: event.response_id });
          break;
        }
        
        case 'response.output_item.added': {
          // Add item to response
          const itemEvent = event as OutputItemAddedEvent;
          const response = activeResponses.get(itemEvent.response_id);
          if (response) {
            response.output.items.push(itemEvent.item);
            logger.debug('Added item to response', {
              response_id: itemEvent.response_id,
              item_id: itemEvent.item.id,
            });
          } else {
            logger.warn('Received output_item.added for unknown response', {
              response_id: itemEvent.response_id,
              item_id: itemEvent.item.id,
              activeResponseCount: activeResponses.size,
            });
          }
          break;
        }
        
        case 'response.output_text.delta': {
          // Accumulate text delta
          const deltaEvent = event as OutputTextDeltaEvent;
          const response = activeResponses.get(deltaEvent.response_id);
          if (response) {
            const item = response.output.items.find(i => i.id === deltaEvent.item_id);
            const contentPart = item?.content[deltaEvent.content_index];
            if (item && contentPart) {
              contentPart.text += deltaEvent.delta.text;
              logger.debug('Accumulated text delta', {
                response_id: deltaEvent.response_id,
                item_id: deltaEvent.item_id,
                delta_length: deltaEvent.delta.text.length,
              });
            } else {
              logger.warn('Received delta for unknown item or content index', {
                response_id: deltaEvent.response_id,
                item_id: deltaEvent.item_id,
                content_index: deltaEvent.content_index,
                itemFound: !!item,
                contentPartFound: !!contentPart,
                itemsCount: response.output.items.length,
              });
            }
          } else {
            logger.warn('Received output_text.delta for unknown response', {
              response_id: deltaEvent.response_id,
              item_id: deltaEvent.item_id,
              activeResponseCount: activeResponses.size,
            });
          }
          break;
        }
        
        case 'response.completed': {
          // Send complete message to OpenClaw
          const response = activeResponses.get(event.response_id);
          if (response) {
            response.status = 'completed';
            
            // Extract complete text from all items
            const fullText = response.output.items
              .flatMap(item => item.content)
              .map(part => part.text)
              .join('');

            logger.info('Response completed', {
              response_id: event.response_id,
              text_length: fullText.length,
              items_count: response.output.items.length,
            });
            
            // 注意：此处是监控路径（topic: /v1.0/im/bot/messages）
            // SDK dispatcher 已在流式回调中实时将各帧事件（delta/completed）推送给远端服务器。
            // 本处是服务端将 bot 消息镜像回来的确认回声，无需再次发送，否则会造成死循环。
            // 仅记录完整文本用于审计日志。
            logger.debug('Response complete (audit log)', {
              response_id: event.response_id,
              text: fullText.substring(0, 200) + (fullText.length > 200 ? '...' : ''),
            });
            
            // Clean up response state
            activeResponses.delete(event.response_id);
          } else {
            logger.warn('Received completed for unknown response', {
              response_id: event.response_id,
              activeResponseCount: activeResponses.size,
            });
          }
          break;
        }
        
        case 'response.failed': {
          // Handle failed response
          const failedEvent = event as ResponseFailedEvent;
          const response = activeResponses.get(failedEvent.response_id);
          if (response) {
            response.status = 'failed';
            logger.error('Response failed', undefined, {
              response_id: failedEvent.response_id,
              error_code: failedEvent.error.code,
              error_message: failedEvent.error.message,
              items_count: response.output.items.length,
            });
            
            // Clean up response state
            activeResponses.delete(failedEvent.response_id);
          } else {
            logger.warn('Received failed for unknown response', {
              response_id: failedEvent.response_id,
              error_code: failedEvent.error.code,
              error_message: failedEvent.error.message,
              activeResponseCount: activeResponses.size,
            });
          }
          break;
        }
        
        default:
          logger.warn('Received unknown event type', {
            type: (event as any).type,
            response_id: (event as any).response_id,
            eventKeys: Object.keys(event),
          });
      }
    } catch (error) {
      // Top-level error handler (Requirement 2.4, 18.1)
      // Log errors with full diagnostic context, continue processing other messages
      const err = error as Error;
      logger.error('Failed to process message', err, {
        message_preview: rawMessage.substring(0, 100),
        message_length: rawMessage.length,
        error_name: err.name,
        error_message: err.message,
        stack: err.stack,
      });
      // Continue operation - don't crash (Requirement 18.1)
    }
  }
  
  /**
   * Handle connection state changes
   * Validates: Requirements 16.1-16.6
   */
  function handleStateChange(state: ConnectionState): void {
    logger.info('Connection state changed', { state });
  }
  
  // Create connection configuration
  const connectionConfig: ConnectionConfig = {
    wsUrl: WS_URL,
    clientId: account.clientId,
    clientSecret: account.clientSecret,
    enabled: account.enabled,
    heartbeatInterval: HEARTBEAT_INTERVAL,
    reconnectMaxAttempts: MAX_RECONNECT_ATTEMPTS, // 0 means infinite reconnection
  };
  
  // Create WebSocket connection manager
  const connection = new WebSocketConnection(
    connectionConfig,
    logger,
    handleMessage,
    handleStateChange
  );
  
  // Set up abort signal handler
  const abortHandler = async () => {
    logger.info('Abort signal received, disconnecting...');
    await connection.disconnect(accountId);
    activeResponses.clear();
    logger.info('Provider monitor stopped');
  };
  
  if (abortSignal.aborted) {
    await abortHandler();
    return;
  }
  
  abortSignal.addEventListener('abort', abortHandler, { once: true });
  
  // Establish connection
  try {
    await connection.connect(accountId);
    
    // Keep the promise alive until abort
    return new Promise<void>((resolve) => {
      abortSignal.addEventListener('abort', () => {
        resolve();
      }, { once: true });
    });
  } catch (error) {
    logger.error('Failed to start provider monitor', error as Error);
    throw error;
  }
}
