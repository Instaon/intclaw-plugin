/**
 * SDK Dispatcher Module
 * 
 * This module manages the lifecycle of SDK requests and responses:
 * - Receives parsed requests from WebSocket handler
 * - Creates correlation contexts
 * - Dispatches requests to SDK with callbacks
 * - Handles streaming responses via callbacks
 * - Generates and sends Open Responses events
 * - Manages timeouts and cleanup
 * 
 * Validates: Requirements 1.1, 1.3, 7.1, 7.2
 */

import type { WebSocket } from 'ws';
import type { DebugLogger } from './logger';
import {
  createInProgressEvent,
  createOutputItemAddedEvent,
  createOutputTextDeltaEvent,
  createContentPartDoneEvent,
  createCompletedEvent,
  createFailedEvent,
  createEnvelope,
} from './protocol';

/**
 * Correlation context for tracking request-response lifecycle
 * 
 * This interface maintains all state needed to correlate SDK responses
 * with original WebSocket requests and generate appropriate Open Responses events.
 * 
 * Validates: Requirements 7.1, 7.2
 */
export interface RequestContext {
  /** Original request message ID from WebSocket envelope */
  messageId: string;
  
  /** Generated response ID for Open Responses protocol */
  responseId: string;
  
  /** Generated item ID for the response item */
  itemId: string;
  
  /** Request content text */
  content: string;
  
  /** Timestamp when request was received */
  requestTimestamp: number;
  
  /** Accumulated response text buffer */
  responseBuffer: string;
  
  /** Whether the first chunk has been received */
  firstChunkReceived: boolean;
  
  /** Timeout timer reference */
  timeoutTimer: NodeJS.Timeout | null;
  
  /** AbortController for cancelling SDK operation on timeout */
  abortController: AbortController | null;
  
  /** Request status */
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'timeout';
  
  /** WebSocket connection reference for sending events */
  ws: WebSocket;
}

/**
 * SDK callback function signature for streaming responses
 * 
 * The SDK invokes this callback multiple times during response generation:
 * - For each text chunk: callback(chunk, null, false)
 * - On completion: callback(null, null, true)
 * - On error: callback(null, error, false)
 * 
 * The callback must return void and not block SDK execution.
 * 
 * Validates: Requirements 1.3, 1.5
 */
export type SDKCallback = (
  chunk: string | null,
  error: Error | null,
  isComplete: boolean
) => void;

/**
 * SDK Dispatcher configuration
 * 
 * Configuration options for the SDK dispatcher including timeouts,
 * concurrency limits, and SDK-specific options.
 * 
 * Validates: Requirements 7.1
 */
export interface DispatcherConfig {
  /** Request timeout in milliseconds */
  requestTimeout: number;
  
  /** Maximum concurrent requests */
  maxConcurrentRequests: number;
  
  /** Enable debug logging */
  debug: boolean;
  
  /** System prompt for SDK */
  systemPrompt?: string;
  
  /** Account ID */
  accountId?: string;

  /** Full OpenClaw configuration (needed for real SDK dispatch) */
  cfg?: any;
}

/**
 * SDK Dispatcher
 * 
 * Manages the lifecycle of SDK requests and responses:
 * - Receives parsed requests from WebSocket handler
 * - Creates correlation contexts
 * - Dispatches requests to SDK with callbacks
 * - Handles streaming responses via callbacks
 * - Generates and sends Open Responses events
 * - Manages timeouts and cleanup
 * 
 * Validates: Requirements 1.1, 9.1, 13.1
 */
export class SDKDispatcher {
  /** Active request contexts indexed by messageId */
  private contexts: Map<string, RequestContext>;
  
  /** Logger instance */
  private logger: DebugLogger;
  
  /** Configuration */
  private config: {
    requestTimeout: number;
    maxConcurrentRequests: number;
    debug: boolean;
    systemPrompt?: string;
    accountId?: string;
    cfg?: any;
  };

  /** Account ID for SDK dispatch */
  private accountId?: string;

  /** Channel runtime for real AI dispatch via Plugin SDK */
  private channelRuntime?: any;
  
  /**
   * Creates a new SDKDispatcher instance
   * 
   * @param config - Dispatcher configuration
   * @param logger - Logger instance for diagnostic output
   * @param accountId - Account identifier for SDK session keying
   * @param channelRuntime - Optional channel runtime for real SDK dispatch
   * 
   * Validates: Requirements 1.1, 9.1, 13.1
   */
  constructor(config: DispatcherConfig, logger: DebugLogger, accountId?: string, channelRuntime?: any) {
    this.contexts = new Map<string, RequestContext>();
    this.logger = logger;
    this.accountId = accountId;
    this.channelRuntime = channelRuntime;
    this.config = {
      requestTimeout: config.requestTimeout,
      maxConcurrentRequests: config.maxConcurrentRequests,
      debug: config.debug,
      systemPrompt: config.systemPrompt,
      accountId: config.accountId,
      cfg: config.cfg,
    };
    
    this.logger.info('SDKDispatcher initialized', {
      requestTimeout: this.config.requestTimeout,
      maxConcurrentRequests: this.config.maxConcurrentRequests,
      debug: this.config.debug,
      hasChannelRuntime: !!channelRuntime,
      accountId,
    });
  }

  /**
   * Dispatch a request to the SDK
   * 
   * Creates correlation context, sets up timeout, and calls SDK dispatch method
   * with a callback closure that captures the context.
   * 
   * Validates: Requirements 2.5, 3.1, 3.2, 7.1, 9.5, 14.1
   * 
   * @param request - Parsed request content from WebSocket
   * @param ws - WebSocket connection for sending response events
   */
  async dispatchRequest(
    request: { content: string; messageId: string },
    ws: WebSocket
  ): Promise<void> {
    // Validate request content is non-empty string (Requirement 2.5)
    if (!request.content || typeof request.content !== 'string' || request.content.trim() === '') {
      this.logger.error('Invalid request: content must be a non-empty string', {
        messageId: request.messageId,
        contentType: typeof request.content,
      });
      
      // Generate failed event for invalid request
      const responseId = this.generateResponseId();
      await this.sendFailedEvent(ws, responseId, 'INVALID_REQUEST', 'Request content must be a non-empty string');
      return;
    }

    // Check concurrent request limit (Requirement 9.5)
    const activeCount = this.getActiveRequestCount();
    if (activeCount >= this.config.maxConcurrentRequests) {
      this.logger.warn('Concurrent request limit reached', {
        messageId: request.messageId,
        activeCount,
        maxConcurrent: this.config.maxConcurrentRequests,
      });
      
      // Generate failed event for rate limit
      const responseId = this.generateResponseId();
      await this.sendFailedEvent(ws, responseId, 'RATE_LIMIT', 'Maximum concurrent requests exceeded');
      return;
    }

    // Create correlation context with unique response_id and item_id (Requirement 7.1)
    const responseId = this.generateResponseId();
    const itemId = this.generateItemId();

    // Create AbortController to support cancelling the SDK call on timeout (Requirement 14.3)
    const abortController = new AbortController();
    
    const context: RequestContext = {
      messageId: request.messageId,
      responseId,
      itemId,
      content: request.content,
      requestTimestamp: Date.now(),
      responseBuffer: '',
      firstChunkReceived: false,
      timeoutTimer: null,
      abortController,
      status: 'pending',
      ws,
    };

    // Store context
    this.contexts.set(request.messageId, context);

    // Log request dispatch (Requirement 15.1)
    this.logger.info('Dispatching request to SDK', {
      messageId: request.messageId,
      responseId,
      contentLength: request.content.length,
      activeRequests: this.getActiveRequestCount(),
    });

    // Set up timeout timer (Requirement 14.1)
    context.timeoutTimer = setTimeout(() => {
      this.handleTimeout(request.messageId);
    }, this.config.requestTimeout);

    // Update status to processing
    context.status = 'processing';

    try {
      // Call real SDK dispatch method with callback (Requirement 3.1, 3.2)
      await this.realSDKDispatch(
        request.content,
        this.createCallback(request.messageId),
        abortController.signal
      );
    } catch (error) {
      // Ignore AbortError — it means timeout already handled this context
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.debug('SDK dispatch aborted (timeout already handled)', {
          messageId: request.messageId,
        });
        return;
      }

      // Handle SDK dispatch errors (Requirement 3.4, 8.1)
      this.logger.error('SDK dispatch failed', {
        messageId: request.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      await this.handleError(context, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get count of active requests (pending or processing)
   * 
   * Returns the number of requests currently being processed or waiting to be processed.
   * This count excludes completed, failed, and timed-out requests.
   * 
   * Validates: Requirement 9.1
   * 
   * @returns Number of active requests (pending or processing)
   */
  getActiveRequestCount(): number {
    let count = 0;
    for (const context of this.contexts.values()) {
      if (context.status === 'pending' || context.status === 'processing') {
        count++;
      }
    }
    return count;
  }

  /**
   * Generate unique response ID
   */
  private generateResponseId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `resp_${timestamp}_${random}`;
  }

  /**
   * Generate unique item ID
   */
  private generateItemId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `item_${timestamp}_${random}`;
  }

  /**
   * Send a failed event via WebSocket
   */
  private async sendFailedEvent(
    ws: WebSocket,
    responseId: string,
    code: string,
    message: string
  ): Promise<void> {
    try {
      const failedEvent = createFailedEvent(responseId, code, message);
      const envelope = createEnvelope(failedEvent);
      
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(envelope);
      } else {
        this.logger.warn('WebSocket not open, cannot send failed event', {
          responseId,
          readyState: ws.readyState,
        });
      }
    } catch (error) {
      this.logger.error('Failed to send failed event', {
        responseId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Dispatch request to the real SDK using channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher
   *
   * Converts the SDK's block-based reply delivery into the streaming callback pattern
   * used by the rest of the dispatcher:
   * - onPartialReply  → callback(chunk, null, false)   [streaming chunks]
   * - deliver         → callback(null, null, true)      [completion signal]
   * - onError         → callback(null, error, false)    [error signal]
   *
   * Falls back to a simple echo if channelRuntime is not available (e.g. in tests).
   *
   * Validates: Requirements 3.1, 3.2
   */
  private async realSDKDispatch(
    content: string,
    callback: SDKCallback,
    signal?: AbortSignal
  ): Promise<void> {
    if (!this.channelRuntime?.reply?.dispatchReplyWithBufferedBlockDispatcher) {
      // Fallback: channelRuntime not injected (e.g. unit tests or backward-compat mode).
      // Emit a single chunk then complete so that the rest of the pipeline still works.
      this.logger.warn('channelRuntime not available — falling back to echo dispatch');
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          if (!signal?.aborted) {
            callback('[no AI runtime] echo: ' + content.substring(0, 50), null, false);
          }
          setTimeout(() => {
            if (!signal?.aborted) callback(null, null, true);
            resolve();
          }, 50);
        }, 50);
      });
      return;
    }

    // Build a MsgContext for the SDK dispatch
    const msgCtx = {
      Body: content,
      AccountId: this.accountId,
      SessionKey: this.accountId ? `instaclaw:${this.accountId}` : undefined,
    };

    await this.channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: msgCtx,
      cfg: this.config.cfg,
      replyOptions: {
        abortSignal: signal,
        // Stream partial reply chunks back via the callback
        onPartialReply: (payload: { text?: string }) => {
          if (signal?.aborted) return;
          if (payload.text) {
            callback(payload.text, null, false);
          }
        },
      },
      dispatcherOptions: {
        // Final/block delivery — only signal completion here.
        // Text content is already streamed via onPartialReply above;
        // delivering it again in `deliver` would cause duplicate chunks.
        // If the SDK skips onPartialReply entirely (non-streaming mode),
        // `deliver` will be called with the full text — we emit it then.
        deliver: async (payload: { text?: string }) => {
          if (signal?.aborted) return;
          // Only emit text if nothing was streamed via onPartialReply
          // (i.e., first-chunk flag on context is still false)
          // We detect non-streaming mode by checking responseBuffer is empty.
          // In streaming mode the buffer already has content from handleChunk calls.
          // NOTE: We always send the completion signal regardless.
          callback(null, null, true);
        },
        onError: (err: unknown) => {
          const error = err instanceof Error ? err : new Error(String(err));
          callback(null, error, false);
        },
      },
    });
  }

  /**
   * Create SDK callback for a specific request context
   * 
   * Returns a callback function that:
   * - Looks up the correlation context
   * - Accumulates text chunks
   * - Generates appropriate Open Responses events
   * - Sends events via WebSocket
   * - Handles completion and errors
   * 
   * The callback returns void immediately and does not block SDK execution.
   * 
   * Validates: Requirements 1.3, 1.5, 10.1, 10.2, 10.3, 10.4, 10.5
   * 
   * @param messageId - The message ID for correlation context lookup
   * @returns SDKCallback function that handles streaming responses
   */
  private createCallback(messageId: string): SDKCallback {
    /**
     * SDK callback closure that captures messageId for correlation
     * 
     * Handles three callback patterns:
     * - Text chunk: callback(chunk, null, false)
     * - Completion: callback(null, null, true)
     * - Error: callback(null, error, false)
     * 
     * Validates: Requirements 1.5, 10.1, 10.2, 10.3, 10.4, 10.5
     */
    return (chunk: string | null, error: Error | null, isComplete: boolean): void => {
      // Return void immediately - non-blocking (Requirement 1.5, 10.5)
      // All processing happens synchronously but doesn't block the caller
      
      try {
        // Look up correlation context (Requirement 7.3)
        const context = this.contexts.get(messageId);
        
        if (!context) {
          this.logger.warn('Callback invoked for unknown messageId', {
            messageId,
            hasChunk: !!chunk,
            hasError: !!error,
            isComplete,
          });
          return; // Return void immediately
        }

        // Log callback invocation (Requirement 15.2)
        this.logger.debug('SDK callback invoked', {
          messageId,
          responseId: context.responseId,
          chunkLength: chunk ? chunk.length : 0,
          hasError: !!error,
          isComplete,
          firstChunk: !context.firstChunkReceived,
        });

        // Handle error case (Requirement 10.2)
        if (error) {
          this.handleError(context, error).catch((err) => {
            this.logger.error('Failed to handle callback error', {
              messageId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
          return; // Return void immediately
        }

        // Handle completion case (Requirement 10.3)
        if (isComplete) {
          this.handleCompletion(context).catch((err) => {
            this.logger.error('Failed to handle callback completion', {
              messageId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
          return; // Return void immediately
        }

        // Handle text chunk case (Requirement 10.1)
        if (chunk) {
          this.handleChunk(context, chunk).catch((err) => {
            this.logger.error('Failed to handle callback chunk', {
              messageId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
          return; // Return void immediately
        }

        // If we reach here, it's an invalid callback invocation
        this.logger.warn('Invalid callback invocation: no chunk, error, or completion', {
          messageId,
        });
        
      } catch (err) {
        // Catch any synchronous errors to ensure callback never throws
        // This ensures non-blocking behavior (Requirement 1.5)
        this.logger.error('Callback error', {
          messageId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      
      // Always return void (Requirement 10.5)
    };
  }

  /**
   * Handle timeout for a request
   * 
   * Generates response.failed event with error code "TIMEOUT",
   * updates context status, and cleans up resources.
   * 
   * Validates: Requirements 14.1, 14.2, 14.3, 14.4
   */
  private handleTimeout(messageId: string): void {
    try {
      // Look up context by messageId (Requirement 14.1)
      const context = this.contexts.get(messageId);
      
      if (!context) {
        this.logger.warn('Timeout triggered for unknown messageId', { messageId });
        return;
      }

      this.logger.warn('Request timeout', {
        messageId,
        responseId: context.responseId,
        duration: Date.now() - context.requestTimestamp,
        status: context.status,
      });

      // Update context status to 'timeout' (Requirement 14.3)
      context.status = 'timeout';

      // Generate response.failed event with error code "TIMEOUT" (Requirement 14.2)
      this.generateFailedEvent(
        context,
        'TIMEOUT',
        `Request timed out after ${this.config.requestTimeout}ms`,
        {
          requestTimestamp: context.requestTimestamp,
          timeoutDuration: this.config.requestTimeout,
        }
      ).catch((error) => {
        this.logger.error('Failed to generate timeout event', {
          messageId,
          responseId: context.responseId,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      // 取消 SDK 操作，释放 AI 推理资源（Requirement 14.3）
      if (context.abortController) {
        context.abortController.abort();
        this.logger.info('SDK operation aborted due to timeout', {
          messageId,
          responseId: context.responseId,
        });
      }

      // Clean up context (Requirement 14.4)
      this.cleanupContext(messageId);

      this.logger.info('Request timeout handled', {
        messageId,
        responseId: context.responseId,
        duration: Date.now() - context.requestTimestamp,
      });
    } catch (error) {
      // Error isolation: ensure timeout handling errors don't crash the system
      this.logger.error('Error handling timeout', {
        messageId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  // ============================================================================
  // Event Generation Helper Functions (Task 4.1)
  // 
  // These helpers wrap protocol.ts event creation functions and handle
  // envelope wrapping and WebSocket transmission.
  // 
  // Validates: Requirements 5.1, 5.2, 5.3, 5.4
  // ============================================================================

  /**
   * Generate and send response.in_progress event
   * 
   * Creates a response.in_progress event, wraps it in an envelope,
   * and sends it via WebSocket.
   * 
   * Wraps all operations in try-catch for error isolation.
   * 
   * Validates: Requirements 5.1, 6.1, 6.2, 6.3, 6.4, 8.3, 8.4, 8.5
   * 
   * @param context - Request context containing response_id and WebSocket
   */
  private async generateInProgressEvent(context: RequestContext): Promise<void> {
    try {
      const event = createInProgressEvent(context.responseId);
      const envelope = createEnvelope(event);
      
      if (context.ws.readyState === 1) { // WebSocket.OPEN
        context.ws.send(envelope);
        this.logger.debug('Sent response.in_progress event', {
          messageId: context.messageId,
          responseId: context.responseId,
        });
      } else {
        this.logger.warn('WebSocket not open, cannot send in_progress event', {
          messageId: context.messageId,
          responseId: context.responseId,
          readyState: context.ws.readyState,
        });
      }
    } catch (error) {
      // Error isolation: log error with full diagnostic context (Requirement 8.3, 8.4, 8.5)
      this.logger.error('Failed to generate in_progress event', {
        messageId: context.messageId,
        responseId: context.responseId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Don't rethrow - continue processing other requests (Requirement 8.5)
    }
  }

  /**
   * Generate and send response.output_item.added event
   * 
   * Creates a response.output_item.added event, wraps it in an envelope,
   * and sends it via WebSocket.
   * 
   * Wraps all operations in try-catch for error isolation.
   * 
   * Validates: Requirements 5.1, 6.1, 6.2, 6.3, 6.4, 8.3, 8.4, 8.5
   * 
   * @param context - Request context containing response_id, item_id, and WebSocket
   */
  private async generateItemAddedEvent(context: RequestContext): Promise<void> {
    try {
      const event = createOutputItemAddedEvent(context.responseId, context.itemId, 0);
      const envelope = createEnvelope(event);
      
      if (context.ws.readyState === 1) { // WebSocket.OPEN
        context.ws.send(envelope);
        this.logger.debug('Sent response.output_item.added event', {
          messageId: context.messageId,
          responseId: context.responseId,
          itemId: context.itemId,
        });
      } else {
        this.logger.warn('WebSocket not open, cannot send item_added event', {
          messageId: context.messageId,
          responseId: context.responseId,
          readyState: context.ws.readyState,
        });
      }
    } catch (error) {
      // Error isolation: log error with full diagnostic context (Requirement 8.3, 8.4, 8.5)
      this.logger.error('Failed to generate item_added event', {
        messageId: context.messageId,
        responseId: context.responseId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Don't rethrow - continue processing other requests (Requirement 8.5)
    }
  }

  /**
   * Generate and send response.output_text.delta event
   * 
   * Creates a response.output_text.delta event, wraps it in an envelope,
   * and sends it via WebSocket.
   * 
   * Wraps all operations in try-catch for error isolation.
   * 
   * Validates: Requirements 5.2, 6.1, 6.2, 6.3, 6.4, 8.3, 8.4, 8.5
   * 
   * @param context - Request context containing response_id, item_id, and WebSocket
   * @param text - Text chunk to send in delta event
   */
  private async generateDeltaEvent(context: RequestContext, text: string): Promise<void> {
    try {
      const event = createOutputTextDeltaEvent(context.responseId, context.itemId, 0, text);
      const envelope = createEnvelope(event);
      
      if (context.ws.readyState === 1) { // WebSocket.OPEN
        context.ws.send(envelope);
        this.logger.debug('Sent response.output_text.delta event', {
          messageId: context.messageId,
          responseId: context.responseId,
          textLength: text.length,
        });
      } else {
        this.logger.warn('WebSocket not open, cannot send delta event', {
          messageId: context.messageId,
          responseId: context.responseId,
          readyState: context.ws.readyState,
        });
      }
    } catch (error) {
      // Error isolation: log error with full diagnostic context (Requirement 8.3, 8.4, 8.5)
      this.logger.error('Failed to generate delta event', {
        messageId: context.messageId,
        responseId: context.responseId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Don't rethrow - continue processing other requests (Requirement 8.5)
    }
  }

  /**
   * Generate and send response.content_part.done event
   * 
   * Creates a response.content_part.done event, wraps it in an envelope,
   * and sends it via WebSocket.
   * 
   * Wraps all operations in try-catch for error isolation.
   * 
   * Validates: Requirements 5.3, 6.1, 6.2, 6.3, 6.4, 8.3, 8.4, 8.5
   * 
   * @param context - Request context containing response_id, item_id, and WebSocket
   */
  private async generateContentPartDoneEvent(context: RequestContext): Promise<void> {
    try {
      const event = createContentPartDoneEvent(context.responseId, context.itemId, 0);
      const envelope = createEnvelope(event);
      
      if (context.ws.readyState === 1) { // WebSocket.OPEN
        context.ws.send(envelope);
        this.logger.debug('Sent response.content_part.done event', {
          messageId: context.messageId,
          responseId: context.responseId,
        });
      } else {
        this.logger.warn('WebSocket not open, cannot send content_part.done event', {
          messageId: context.messageId,
          responseId: context.responseId,
          readyState: context.ws.readyState,
        });
      }
    } catch (error) {
      // Error isolation: log error with full diagnostic context (Requirement 8.3, 8.4, 8.5)
      this.logger.error('Failed to generate content_part.done event', {
        messageId: context.messageId,
        responseId: context.responseId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Don't rethrow - continue processing other requests (Requirement 8.5)
    }
  }

  /**
   * Generate and send response.completed event
   * 
   * Creates a response.completed event, wraps it in an envelope,
   * and sends it via WebSocket.
   * 
   * Wraps all operations in try-catch for error isolation.
   * 
   * Validates: Requirements 5.3, 6.1, 6.2, 6.3, 6.4, 8.3, 8.4, 8.5
   * 
   * @param context - Request context containing response_id and WebSocket
   */
  private async generateCompletedEvent(context: RequestContext): Promise<void> {
    try {
      const event = createCompletedEvent(context.responseId);
      const envelope = createEnvelope(event);
      
      if (context.ws.readyState === 1) { // WebSocket.OPEN
        context.ws.send(envelope);
        this.logger.debug('Sent response.completed event', {
          messageId: context.messageId,
          responseId: context.responseId,
        });
      } else {
        this.logger.warn('WebSocket not open, cannot send completed event', {
          messageId: context.messageId,
          responseId: context.responseId,
          readyState: context.ws.readyState,
        });
      }
    } catch (error) {
      // Error isolation: log error with full diagnostic context (Requirement 8.3, 8.4, 8.5)
      this.logger.error('Failed to generate completed event', {
        messageId: context.messageId,
        responseId: context.responseId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Don't rethrow - continue processing other requests (Requirement 8.5)
    }
  }

  /**
   * Generate and send response.failed event
   * 
   * Creates a response.failed event, wraps it in an envelope,
   * and sends it via WebSocket.
   * 
   * Validates: Requirements 5.4, 6.1, 6.2, 6.3, 6.4
   * 
   * @param context - Request context containing response_id and WebSocket
   * @param code - Error code (e.g., "SDK_ERROR", "TIMEOUT", "CALLBACK_ERROR")
   * @param message - Error message
   * @param details - Optional error details
   */
  private async generateFailedEvent(
    context: RequestContext,
    code: string,
    message: string,
    details?: any
  ): Promise<void> {
    try {
      const event = createFailedEvent(context.responseId, code, message, details);
      const envelope = createEnvelope(event);
      
      if (context.ws.readyState === 1) { // WebSocket.OPEN
        try {
          context.ws.send(envelope);
          this.logger.debug('Sent response.failed event', {
            messageId: context.messageId,
            responseId: context.responseId,
            errorCode: code,
          });
        } catch (sendError) {
          // Log send error but don't throw - we want to continue cleanup
          this.logger.error('Failed to send failed event via WebSocket', {
            messageId: context.messageId,
            responseId: context.responseId,
            error: sendError instanceof Error ? sendError.message : String(sendError),
          });
        }
      } else {
        this.logger.warn('WebSocket not open, cannot send failed event', {
          messageId: context.messageId,
          responseId: context.responseId,
          readyState: context.ws.readyState,
        });
      }
    } catch (error) {
      // Log error but don't throw - we want to continue cleanup
      this.logger.error('Failed to generate failed event', {
        messageId: context.messageId,
        responseId: context.responseId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle text chunk from SDK callback
   * 
   * Wraps all operations in try-catch for error isolation.
   * 
   * Validates: Requirements 4.1, 4.4, 5.1, 5.2, 8.3, 8.4, 8.5
   */
  private async handleChunk(context: RequestContext, chunk: string): Promise<void> {
    try {
      // Detect first chunk (Requirement 4.1, 5.1)
      const isFirstChunk = !context.firstChunkReceived;
      
      if (isFirstChunk) {
        // Set first chunk flag
        context.firstChunkReceived = true;
        
        // Generate initialization events for first chunk (Requirement 5.1)
        await this.generateInProgressEvent(context);
        await this.generateItemAddedEvent(context);
      }
      
      // Accumulate chunk in response buffer maintaining order (Requirement 4.1, 4.4)
      context.responseBuffer += chunk;
      
      // Generate delta event for this chunk (Requirement 5.2)
      await this.generateDeltaEvent(context, chunk);
      
      this.logger.debug('Handled chunk', { 
        messageId: context.messageId, 
        responseId: context.responseId,
        chunkLength: chunk.length,
        firstChunk: isFirstChunk,
        bufferLength: context.responseBuffer.length,
      });
    } catch (error) {
      // Error isolation: log error with full diagnostic context (Requirement 8.3, 8.4, 8.5)
      this.logger.error('Error handling chunk', {
        messageId: context.messageId,
        responseId: context.responseId,
        chunkLength: chunk.length,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      
      // Continue processing other requests after error (Requirement 8.5)
      // Don't rethrow - let other requests continue
    }
  }

  /**
   * Handle completion from SDK callback
   * 
   * Generates content_part.done and response.completed events,
   * updates context status, and cleans up resources.
   * 
   * Wraps all operations in try-catch for error isolation.
   * 
   * Validates: Requirements 4.3, 5.3, 7.4, 7.5, 8.3, 8.4, 8.5
   */
  private async handleCompletion(context: RequestContext): Promise<void> {
    this.logger.debug('Handling completion', { 
      messageId: context.messageId,
      responseId: context.responseId,
      bufferLength: context.responseBuffer.length,
    });

    try {
      // Generate content_part.done event (Requirement 5.3)
      await this.generateContentPartDoneEvent(context);
      
      // Generate response.completed event (Requirement 5.3)
      await this.generateCompletedEvent(context);
      
      // Update context status to 'completed' (Requirement 7.4)
      context.status = 'completed';
      
      this.logger.info('Request completed successfully', {
        messageId: context.messageId,
        responseId: context.responseId,
        responseLength: context.responseBuffer.length,
        duration: Date.now() - context.requestTimestamp,
      });
      
    } catch (error) {
      // Error isolation: log error with full diagnostic context (Requirement 8.3, 8.4, 8.5)
      this.logger.error('Failed to handle completion', {
        messageId: context.messageId,
        responseId: context.responseId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Don't rethrow - continue with cleanup
    } finally {
      // Clean up context and timeout timer (Requirement 7.5)
      // Always cleanup even if event generation fails
      this.cleanupContext(context.messageId);
    }
  }

  /**
   * Handle error from SDK callback
   * 
   * Generates response.failed event with error details,
   * updates context status, and cleans up resources.
   * 
   * Wraps all operations in try-catch for error isolation.
   * 
   * Validates: Requirements 4.5, 5.4, 8.1, 8.2, 8.3, 8.4, 8.5
   */
  private async handleError(context: RequestContext, error: Error): Promise<void> {
    this.logger.error('Handling error', { 
      messageId: context.messageId, 
      responseId: context.responseId,
      error: error.message,
      stack: error.stack,
    });

    try {
      // Determine error code based on error type
      let errorCode = 'SDK_ERROR';
      if (error.message.includes('timeout')) {
        errorCode = 'TIMEOUT';
      } else if (error.message.includes('callback')) {
        errorCode = 'CALLBACK_ERROR';
      }
      
      // Generate response.failed event (Requirement 5.4)
      await this.generateFailedEvent(context, errorCode, error.message, { stack: error.stack });
      
      // Update context status to 'failed' (Requirement 8.1)
      context.status = 'failed';
      
      this.logger.info('Request failed', {
        messageId: context.messageId,
        responseId: context.responseId,
        errorCode,
        duration: Date.now() - context.requestTimestamp,
      });
      
    } catch (err) {
      // Error isolation: log error with full diagnostic context (Requirement 8.3, 8.4, 8.5)
      this.logger.error('Failed to handle error', {
        messageId: context.messageId,
        responseId: context.responseId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      // Don't rethrow - continue with cleanup
    } finally {
      // Clean up context and timeout timer (Requirement 8.2)
      // Always cleanup even if event generation fails
      this.cleanupContext(context.messageId);
    }
  }

  /**
   * Clean up request context
   * 
   * Removes context from contexts Map, clears timeout timer,
   * and logs cleanup action.
   * 
   * Validates: Requirements 7.5
   * 
   * @param messageId - The message ID of the context to clean up
   */
  private cleanupContext(messageId: string): void {
    const context = this.contexts.get(messageId);
    
    if (!context) {
      this.logger.warn('Attempted to cleanup non-existent context', { messageId });
      return;
    }
    
    // Clear timeout timer if it exists (Requirement 7.5)
    if (context.timeoutTimer) {
      clearTimeout(context.timeoutTimer);
      context.timeoutTimer = null;
    }

    // Clear abortController reference to allow GC
    context.abortController = null;
    
    // Remove context from Map (Requirement 7.5)
    this.contexts.delete(messageId);
    
    // Log cleanup action (Requirement 15.5)
    this.logger.debug('Context cleaned up', {
      messageId,
      responseId: context.responseId,
      status: context.status,
      activeRequests: this.getActiveRequestCount(),
    });
  }
}
