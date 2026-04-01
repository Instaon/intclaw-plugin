/**
 * Type Definitions for Instagram Claw Connector
 *
 * This module contains all TypeScript type definitions for the plugin,
 * including configuration types, connection states, WebSocket envelope format,
 * Open Responses event types, and data models.
 *
 * All WebSocket / Open Responses types strictly follow open-responses.md.
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

// ============================================================================
// WebSocket Envelope (open-responses.md §7)
//
// 每个 Open Responses 事件通过此 Envelope 在 WebSocket 上传输。
// - type: 固定为大写 "MESSAGE"
// - headers.messageId: 唯一消息标识
// - headers.topic: 消息路由主题
//   · 插件 → 服务端（bot 消息）: "/v1.0/im/bot/messages"
//   · 服务端 → 插件（用户消息）: "/v1.0/im/user/messages"
// - data: 事件对象序列化后的 JSON 字符串
// ============================================================================

/**
 * WebSocket Envelope format — per open-responses.md §7
 * Validates: Requirements 10.5, 18.1
 */
export interface WebSocketEnvelope {
  /** Message type — always "MESSAGE" (uppercase) */
  type: "MESSAGE";
  /** Message headers */
  headers: {
    /** Unique message identifier, e.g. "msg_001" */
    messageId: string;
    /** Routing topic, e.g. "/v1.0/im/bot/messages" */
    topic: string;
    /** Additional headers (flexible extension) */
    [key: string]: string;
  };
  /** Serialized JSON string of the event / request payload */
  data: string;
}

// ============================================================================
// Open Responses Event Types (open-responses.md §5–§6)
// ============================================================================

/**
 * Base event interface for all Open Responses events.
 * Per open-responses.md §6, every server-emitted event contains at least:
 *   - type: event type identifier
 *   - response_id: for client correlation
 *   - timestamp: ISO 8601
 */
export interface BaseEvent {
  /** Event type identifier, e.g. "response.in_progress" */
  type: string;
  /** Unique response identifier, e.g. "resp_123" */
  response_id: string;
  /** ISO 8601 timestamp, e.g. "2026-03-25T08:00:00Z" */
  timestamp: string;
}

/**
 * response.in_progress — Response enters in_progress state.
 * open-responses.md §6.1
 */
export interface ResponseInProgressEvent extends BaseEvent {
  type: 'response.in_progress';
  /** Must be "in_progress" */
  status: 'in_progress';
}

/**
 * response.output_item.added — A new Item is added to output.
 * open-responses.md §6.2
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
 * open-responses.md §6.3
 */
export interface OutputTextDeltaEvent extends BaseEvent {
  type: 'response.output_text.delta';
  /** ID of the item to update */
  item_id: string;
  /** Index in item.content[] */
  content_index: number;
  /** Incremental text delta */
  delta: {
    text: string;
  };
}

/**
 * response.content_part.done (optional) — Marks a content part completed.
 * open-responses.md §6.4
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
 * open-responses.md §6.5
 */
export interface ResponseCompletedEvent extends BaseEvent {
  type: 'response.completed';
  /** Must be "completed" */
  status: 'completed';
}

/**
 * response.failed — Unrecoverable error during response.
 * open-responses.md §6.6
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
// Data Model Types (open-responses.md §2–§4)
// ============================================================================

/**
 * Top-level Response object (open-responses.md §2).
 * Server-internal state; not transmitted over the wire directly.
 */
export interface Response {
  /** Unique response identifier, e.g. "resp_123" */
  id: string;
  /** Response status: queued → in_progress → completed / failed / incomplete */
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'incomplete';
  /** Output containing items array */
  output: {
    items: Item[];
  };
  /** Error details when status is "failed", null otherwise */
  error: null | {
    code: string;
    message: string;
    details: any;
  };
  /** Extension metadata, e.g. trace id */
  metadata: Record<string, any>;
}

/**
 * Item object — output item within a response (open-responses.md §3).
 * Validates: Requirements 18.1
 */
export interface Item {
  /** Unique item identifier, e.g. "item_1" */
  id: string;
  /** Type of the item */
  type: 'message' | 'function_call' | 'function_call_output' | 'reasoning';
  /** Status of the item */
  status: 'in_progress' | 'completed' | 'incomplete' | 'failed';
  /** Role of the message sender (for message type) */
  role?: 'assistant' | 'user';
  /** Array of content parts */
  content: ContentPart[];
}

/**
 * Content Part — fine-grained content fragment within an Item (open-responses.md §4).
 * Validates: Requirements 18.1
 */
export interface ContentPart {
  /** Type of content, typically "output_text" for model output */
  type: 'output_text';
  /** Status of this content part */
  status: 'in_progress' | 'completed';
  /** Accumulated text content */
  text: string;
  /** Optional annotations */
  annotations?: any[];
  /** Optional log probabilities */
  logprobs?: any;
}

// ============================================================================
// Inbound Request Types (open-responses.md §9.1)
//
// 客户端（用户端）发给服务端的消息格式，data 只包含用户内容。
// 示例:
//   { "type": "MESSAGE", "headers": { "messageId": "msg_req_001",
//     "topic": "/v1.0/im/user/messages" }, "data": "{\"content\":\"你好呀\"}" }
// ============================================================================

/**
 * Inbound user message content — parsed from envelope.data
 * Note: per open-responses.md §9.1, data only carries `content`.
 */
export interface InboundMessageContent {
  /** User message text */
  content: string;
  /** Optional extra fields forwarded by the gateway */
  [key: string]: any;
}

/**
 * Parsed request context — enriched by the gateway from envelope headers
 */
export interface RequestContent {
  /** User message content */
  content: string;
  /** Message ID from envelope.headers.messageId */
  messageId: string;
  /** Topic from envelope.headers.topic */
  topic: string;
  /** Any additional header values */
  [key: string]: any;
}

/**
 * Response context for tracking request-response mapping
 */
export interface ResponseContext {
  /** Message ID from the originating request */
  messageId: string;
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
