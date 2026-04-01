/**
 * Protocol Handler Module
 *
 * Implements the Open Responses protocol for the InstaClaw Connector.
 * All event structures strictly follow open-responses.md.
 *
 * Key rules (from open-responses.md §7):
 *  - Envelope.type = "MESSAGE" (uppercase)
 *  - Envelope.headers = { messageId, topic }  (no timestamp in headers)
 *  - Envelope.data = JSON.stringify(event)     (stringified, not a nested object)
 *  - Bot → Server topic: "/v1.0/im/bot/messages"
 *  - User → Bot topic:   "/v1.0/im/user/messages"
 */

import type {
  WebSocketEnvelope,
  OpenResponsesEvent,
  ResponseInProgressEvent,
  OutputItemAddedEvent,
  OutputTextDeltaEvent,
  ContentPartDoneEvent,
  ResponseCompletedEvent,
  ResponseFailedEvent,
  RequestContent,
  InboundMessageContent,
} from './types';
import { TEXT_CHUNK_SIZE } from './config';

// ============================================================================
// Well-known topics (open-responses.md §9)
// ============================================================================

export const TOPIC_BOT_MESSAGES = '/v1.0/im/bot/messages';
export const TOPIC_USER_MESSAGES = '/v1.0/im/user/messages';

// ============================================================================
// Helpers
// ============================================================================

function generateMessageId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `msg_${timestamp}_${random}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

// ============================================================================
// Envelope Parsing — inbound user messages (open-responses.md §9.1)
// ============================================================================

/**
 * Parse an inbound WebSocket Envelope from the user side.
 *
 * Per open-responses.md §9.1 the client only sends:
 *   { type: "MESSAGE", headers: { messageId, topic }, data: '{"content":"..."}' }
 *
 * Returns the RequestContent enriched with headers info.
 */
export function parseRequest(rawMessage: string): RequestContent {
  try {
    const envelope = JSON.parse(rawMessage) as WebSocketEnvelope;

    if (envelope.type !== 'MESSAGE') {
      throw new Error(`Invalid envelope: expected type "MESSAGE", got "${envelope.type}"`);
    }

    if (!envelope.data || typeof envelope.data !== 'string') {
      throw new Error('Invalid envelope: missing or non-string data field');
    }

    if (!envelope.headers || typeof envelope.headers !== 'object') {
      throw new Error('Invalid envelope: missing or invalid headers field');
    }

    const messageId = envelope.headers['messageId'];
    if (!messageId) {
      throw new Error('Invalid envelope: missing headers.messageId');
    }

    const topic = envelope.headers['topic'] ?? TOPIC_USER_MESSAGES;

    // data is the user payload — per spec only `content` is required
    const payload = JSON.parse(envelope.data) as InboundMessageContent;

    if (!payload.content || typeof payload.content !== 'string') {
      throw new Error('Invalid request data: missing or non-string content field');
    }

    // Spread extra gateway fields first, then explicitly set the verified required fields
    // so they always take precedence over anything in the raw payload.
    const { content: _rawContent, ...extra } = payload;
    return {
      ...extra,
      content: payload.content,
      messageId,
      topic,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      const preview = rawMessage.substring(0, 100);
      throw new Error(`Failed to parse request envelope: ${error.message}. Raw: ${preview}`);
    }
    throw error;
  }
}

// ============================================================================
// Envelope Parsing — inbound Open Responses events (open-responses.md §6)
//
// Used when the plugin receives server-emitted events (e.g. for monitoring/relay).
// ============================================================================

/**
 * Parse a WebSocket Envelope and extract the Open Responses event from data.
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.8
 */
export function parseEnvelope(rawMessage: string): OpenResponsesEvent {
  try {
    const envelope = JSON.parse(rawMessage) as WebSocketEnvelope;

    if (envelope.type !== 'MESSAGE') {
      throw new Error(`Invalid envelope: expected type "MESSAGE", got "${envelope.type}"`);
    }

    if (!envelope.data || typeof envelope.data !== 'string') {
      throw new Error('Invalid envelope: missing or non-string data field');
    }

    if (!envelope.headers || typeof envelope.headers !== 'object') {
      throw new Error('Invalid envelope: missing or invalid headers field');
    }

    const event = JSON.parse(envelope.data) as OpenResponsesEvent;

    if (!event.type || typeof event.type !== 'string') {
      throw new Error('Invalid event: missing or invalid type field');
    }

    if (!event.response_id || typeof event.response_id !== 'string') {
      throw new Error('Invalid event: missing or invalid response_id field');
    }

    return event;
  } catch (error) {
    if (error instanceof SyntaxError) {
      const preview = rawMessage.substring(0, 100);
      throw new Error(`Failed to parse envelope: ${error.message}. Raw: ${preview}`);
    }
    throw error;
  }
}

// ============================================================================
// Envelope Creation (open-responses.md §7)
//
// Wraps an Open Responses event in the standard WebSocket Envelope.
// - type: "MESSAGE"  (uppercase, per spec)
// - headers: { messageId, topic }  (no timestamp)
// - data: JSON.stringify(event)
// ============================================================================

/**
 * Create a WebSocket Envelope string from an Open Responses event.
 *
 * topic defaults to TOPIC_BOT_MESSAGES ("/v1.0/im/bot/messages") for
 * all bot-originated messages, per open-responses.md §9.2.
 *
 * Validates: Requirements 11.4, 11.5, 11.6
 */
export function createEnvelope(
  event: OpenResponsesEvent,
  topic: string = TOPIC_BOT_MESSAGES
): string {
  const envelope: WebSocketEnvelope = {
    type: 'MESSAGE',
    headers: {
      messageId: generateMessageId(),
      topic,
    },
    data: JSON.stringify(event),
  };

  return JSON.stringify(envelope);
}

// ============================================================================
// Event Creation Helpers (open-responses.md §6)
// ============================================================================

/**
 * Create a response.in_progress event.  (§6.1)
 */
export function createInProgressEvent(responseId: string): ResponseInProgressEvent {
  return {
    type: 'response.in_progress',
    response_id: responseId,
    status: 'in_progress',
    timestamp: isoNow(),
  };
}

/**
 * Create a response.output_item.added event.  (§6.2)
 */
export function createOutputItemAddedEvent(
  responseId: string,
  itemId: string,
  index: number = 0
): OutputItemAddedEvent {
  return {
    type: 'response.output_item.added',
    response_id: responseId,
    item: {
      id: itemId,
      type: 'message',
      status: 'in_progress',
      role: 'assistant',
      content: [{ type: 'output_text', status: 'in_progress', text: '' }],
    },
    index,
    timestamp: isoNow(),
  };
}

/**
 * Create a response.output_text.delta event.  (§6.3)
 */
export function createOutputTextDeltaEvent(
  responseId: string,
  itemId: string,
  contentIndex: number,
  text: string
): OutputTextDeltaEvent {
  return {
    type: 'response.output_text.delta',
    response_id: responseId,
    item_id: itemId,
    content_index: contentIndex,
    delta: { text },
    timestamp: isoNow(),
  };
}

/**
 * Create a response.content_part.done event.  (§6.4)
 */
export function createContentPartDoneEvent(
  responseId: string,
  itemId: string,
  contentIndex: number
): ContentPartDoneEvent {
  return {
    type: 'response.content_part.done',
    response_id: responseId,
    item_id: itemId,
    content_index: contentIndex,
    status: 'completed',
    timestamp: isoNow(),
  };
}

/**
 * Create a response.completed event.  (§6.5)
 */
export function createCompletedEvent(responseId: string): ResponseCompletedEvent {
  return {
    type: 'response.completed',
    response_id: responseId,
    status: 'completed',
    timestamp: isoNow(),
  };
}

/**
 * Create a response.failed event.  (§6.6)
 */
export function createFailedEvent(
  responseId: string,
  code: string,
  message: string,
  details: any = null
): ResponseFailedEvent {
  return {
    type: 'response.failed',
    response_id: responseId,
    status: 'failed',
    error: { code, message, details },
    timestamp: isoNow(),
  };
}

// ============================================================================
// Text → Event Sequence Conversion (open-responses.md §9.2 flow)
//
// A complete one-answer cycle emits 5 types of frames in order:
//   1. response.in_progress
//   2. response.output_item.added
//   3. response.output_text.delta  (N times, chunked)
//   4. response.content_part.done
//   5. response.completed
// ============================================================================

/**
 * Convert a full response text to an Open Responses event sequence.
 *
 * Validates: Requirements 8.3
 */
export function textToEventSequence(text: string, responseId?: string): OpenResponsesEvent[] {
  const respId = responseId ?? `resp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const itemId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const events: OpenResponsesEvent[] = [
    createInProgressEvent(respId),
    createOutputItemAddedEvent(respId, itemId),
  ];

  for (let i = 0; i < text.length; i += TEXT_CHUNK_SIZE) {
    const chunk = text.substring(i, i + TEXT_CHUNK_SIZE);
    events.push(createOutputTextDeltaEvent(respId, itemId, 0, chunk));
  }

  events.push(createContentPartDoneEvent(respId, itemId, 0));
  events.push(createCompletedEvent(respId));

  return events;
}

// ============================================================================
// Response Generation from Request (open-responses.md §9)
// ============================================================================

/**
 * Generate Open Responses event sequence from a parsed RequestContent.
 *
 * Validates: Requirements 2.2, 2.3, 2.5
 */
export function generateResponseSequence(
  _request: RequestContent,
  responseText: string
): OpenResponsesEvent[] {
  return textToEventSequence(responseText);
}
