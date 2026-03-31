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
 * Base event interface for all Open Responses events
 * Validates: Requirements 10.1, 18.2
 */
export interface BaseEvent {
  /** Event type identifier */
  type: string;
  /** Unique event identifier */
  event_id: string;
  /** Unique response identifier */
  response_id: string;
}

/**
 * Response in progress event
 * Validates: Requirements 10.1, 18.2
 */
export interface ResponseInProgressEvent extends BaseEvent {
  type: 'response.in_progress';
}

/**
 * Output item added event
 * Validates: Requirements 10.1, 18.2
 */
export interface OutputItemAddedEvent extends BaseEvent {
  type: 'response.output_item.added';
  /** The item being added */
  item: Item;
}

/**
 * Output text delta event (streaming text)
 * Validates: Requirements 10.1, 18.2
 */
export interface OutputTextDeltaEvent extends BaseEvent {
  type: 'response.output_text.delta';
  /** ID of the item containing this text */
  item_id: string;
  /** Index of the content part within the item */
  content_index: number;
  /** Text delta */
  delta: {
    /** Incremental text content */
    text: string;
  };
}

/**
 * Response completed event
 * Validates: Requirements 10.1, 18.2
 */
export interface ResponseCompletedEvent extends BaseEvent {
  type: 'response.completed';
}

/**
 * Response failed event
 * Validates: Requirements 10.1, 18.2
 */
export interface ResponseFailedEvent extends BaseEvent {
  type: 'response.failed';
  /** Error details */
  error: {
    /** Error code */
    code: string;
    /** Error message */
    message: string;
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
  | ResponseCompletedEvent
  | ResponseFailedEvent;

// ============================================================================
// Data Model Types
// ============================================================================

/**
 * Response object (top-level response container)
 * Validates: Requirements 18.1
 */
export interface Response {
  /** Unique response identifier */
  id: string;
  /** Current status of the response */
  status: "in_progress" | "completed" | "failed";
  /** Array of output items */
  items: Item[];
  /** Creation timestamp */
  createdAt: number;
}

/**
 * Item object (output item within a response)
 * Validates: Requirements 18.1
 */
export interface Item {
  /** Unique item identifier */
  id: string;
  /** Type of the item (MVP: only "message" supported) */
  type: "message";
  /** Array of content parts */
  content: ContentPart[];
}

/**
 * Content part object (content fragment within an item)
 * Validates: Requirements 18.1
 */
export interface ContentPart {
  /** Type of content (MVP: only "text" supported) */
  type: "text";
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
