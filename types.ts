/**
 * Type Definitions for Instagram Claw Connector
 * 
 * This module contains all TypeScript type definitions for the plugin,
 * including configuration types, connection states, WebSocket envelope format,
 * Open Responses event types, and data models.
 */

// ============================================================================
// Core Configuration Types
// ============================================================================

/**
 * Plugin configuration interface (from OpenClaw)
 * Validates: Requirements 4.2, 18.1
 */
export interface PluginConfig {
  /** Whether the plugin is enabled */
  enabled: boolean;
  /** App Key for authentication */
  clientId: string;
  /** App Secret for authentication (sensitive) */
  clientSecret: string;
  /** Optional system prompt */
  systemPrompt?: string;
}

/**
 * Runtime configuration interface
 * Validates: Requirements 6.2, 14.1
 */
export interface RuntimeConfig {
  /** WebSocket server URL */
  wsUrl: string;
  /** Enable debug logging */
  debug: boolean;
  /** Heartbeat interval in milliseconds */
  heartbeatInterval: number;
  /** Maximum reconnection attempts (undefined = infinite) */
  reconnectMaxAttempts?: number;
}

/**
 * Connection state type (string literal union)
 * Validates: Requirements 13.1, 14.1
 */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

/**
 * WebSocket Envelope format
 * Validates: Requirements 10.5, 18.1
 */
export interface WebSocketEnvelope {
  /** Message type */
  type: "message" | "control";
  /** Message headers */
  headers: {
    /** Unique message identifier */
    messageId: string;
    /** Timestamp in milliseconds */
    timestamp: number;
    /** Additional headers */
    [key: string]: any;
  };
  /** Message data (JSON string) */
  data: string;
}

// ============================================================================
// Open Responses Event Types
// ============================================================================

/**
 * Base event interface for all Open Responses events.
 * Per open-responses.md spec, every event data contains at least:
 *   - type: event type identifier
 *   - response_id: for client correlation
 *   - timestamp: ISO 8601
 */
export interface BaseEvent {
  /** Event type identifier */
  type: string;
  /** Unique response identifier */
  response_id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * response.in_progress — Response enters in_progress state.
 */
export interface ResponseInProgressEvent extends BaseEvent {
  type: 'response.in_progress';
  /** Must be "in_progress" */
  status: 'in_progress';
}

/**
 * response.output_item.added — A new Item is added to output.
 */
export interface OutputItemAddedEvent extends BaseEvent {
  type: 'response.output_item.added';
  /** The item being added */
  item: Item;
  /** Index of this item in output.items[] */
  index: number;
}

/**
 * response.output_text.delta — Incremental text content.
 */
export interface OutputTextDeltaEvent extends BaseEvent {
  type: 'response.output_text.delta';
  /** ID of the item to update */
  item_id: string;
  /** Index in item.content[] */
  content_index: number;
  /** Incremental text */
  delta: {
    text: string;
  };
}

/**
 * response.content_part.done (optional) — Marks a content part completed.
 */
export interface ContentPartDoneEvent extends BaseEvent {
  type: 'response.content_part.done';
  /** ID of the item */
  item_id: string;
  /** Index in item.content[] */
  content_index: number;
  /** Typically "completed" */
  status: 'completed';
}

/**
 * response.completed — Entire response is done successfully.
 */
export interface ResponseCompletedEvent extends BaseEvent {
  type: 'response.completed';
  /** Must be "completed" */
  status: 'completed';
}

/**
 * response.failed — Unrecoverable error during response.
 */
export interface ResponseFailedEvent extends BaseEvent {
  type: 'response.failed';
  /** Must be "failed" */
  status: 'failed';
  /** Standardized error object */
  error: {
    code: string;
    message: string;
    details: any;
  };
}

/**
 * Discriminated union of all Open Responses event types
 * Validates: Requirements 10.1, 18.3
 */
export type OpenResponsesEvent =
  | ResponseInProgressEvent
  | OutputItemAddedEvent
  | OutputTextDeltaEvent
  | ContentPartDoneEvent
  | ResponseCompletedEvent
  | ResponseFailedEvent;

// ============================================================================
// Data Model Types
// ============================================================================

/**
 * Response object (top-level response container, per open-responses.md §2).
 */
export interface Response {
  /** Unique response identifier (e.g. "resp_123") */
  id: string;
  /** Response status: queued, in_progress, completed, failed, incomplete */
  status: "queued" | "in_progress" | "completed" | "failed" | "incomplete";
  /** Output containing items array */
  output: {
    items: Item[];
  };
  /** Error details when status is "failed" */
  error: null | {
    code: string;
    message: string;
    details: any;
  };
  /** Extension metadata (trace id, etc.) */
  metadata: Record<string, any>;
}

/**
 * Item object (output item within a response)
 * Validates: Requirements 18.1
 */
export interface Item {
  /** Unique item identifier */
  id: string;
  /** Type of the item */
  type: "message" | "function_call" | "function_call_output" | "reasoning";
  /** Status of the item */
  status: "in_progress" | "completed" | "incomplete" | "failed";
  /** Role of the message sender (for message type) */
  role?: "assistant" | "user";
  /** Array of content parts */
  content: ContentPart[];
}

/**
 * Content part object (content fragment within an item)
 * Validates: Requirements 18.1
 */
export interface ContentPart {
  /** Type of content */
  type: "output_text";
  /** Status of this content part */
  status: "in_progress" | "completed";
  /** Text content */
  text: string;
}

// ============================================================================
// Request-Response Types
// ============================================================================

/**
 * Request envelope from server
 * Represents the WebSocket Envelope format for server requests
 * Validates: Requirements 2.1, 2.4
 */
export interface RequestEnvelope {
  /** Message type for requests */
  type: "request" | "message";
  /** Message headers */
  headers: {
    /** Unique message identifier */
    messageId: string;
    /** Timestamp in milliseconds */
    timestamp: number;
    /** Optional request identifier for tracking */
    requestId?: string;
    /** Additional headers */
    [key: string]: any;
  };
  /** Request data (JSON string) */
  data: string;
}

/**
 * Request content structure from server
 * Represents the parsed content of a server request
 * Validates: Requirements 2.1, 2.4
 */
export interface RequestContent {
  /** Request type (e.g., "user.message") */
  type: string;
  /** User message content */
  content: string;
  /** User identifier */
  userId: string;
  /** Optional request identifier for tracking */
  requestId?: string;
}

/**
 * Response context for tracking request-response mapping
 * Used to maintain context when generating responses to requests
 * Validates: Requirements 2.4
 */
export interface ResponseContext {
  /** Request identifier this response is for */
  requestId: string;
  /** User identifier from the request */
  userId: string;
  /** Timestamp when request was received */
  requestTimestamp: number;
  /** Optional additional context data */
  metadata?: Record<string, any>;
}

// ============================================================================
// Connection Configuration
// ============================================================================

/**
 * Connection configuration for WebSocket manager
 * Internal type used by connection.ts
 */
export interface ConnectionConfig {
  /** WebSocket server URL */
  wsUrl: string;
  /** Client ID for authentication */
  clientId: string;
  /** Client secret for authentication */
  clientSecret: string;
  /** Whether the connection is enabled */
  enabled: boolean;
  /** Heartbeat interval in milliseconds */
  heartbeatInterval: number;
  /** Maximum reconnection attempts */
  reconnectMaxAttempts?: number;
}
