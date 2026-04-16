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

/**
 * Build session identifier from userId and channelId
 * 
 * Constructs a deterministic session identifier in the format:
 * channel:{channelId}:user:{userId}
 * 
 * This implements OpenClaw's per-channel-peer isolation mode.
 * 
 * @param userId - User identifier (will be converted to string)
 * @param channelId - Channel identifier (will be converted to string)
 * @returns Session identifier string
 * 
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */
export function buildSessionId(userId: string | number, channelId: string | number): string {
  return `channel:${String(channelId)}:user:${String(userId)}`;
}

// ============================================================================
// Envelope Parsing — inbound user messages (open-responses.md §9.1)
// ============================================================================

/**
 * Parse an inbound standard request object from the WebSocket.
 *
 * Per open-responses.md specification, the server sends standard request objects:
 *   { model: "...", stream: true/false, input: [...], metadata: { session_id: "..." } }
 *
 * Returns the RequestContent with extracted fields from the standard format.
 * 
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.7
 */
export function parseRequest(rawMessage: string): RequestContent {
  try {
    // Parse standard request format directly (no envelope wrapper)
    const request = JSON.parse(rawMessage) as any;

    // Validate required fields in standard request format
    if (!request.input || !Array.isArray(request.input) || request.input.length === 0) {
      throw new Error('Invalid request: missing or empty input array');
    }

    const firstInput = request.input[0];
    if (!firstInput.content || !Array.isArray(firstInput.content) || firstInput.content.length === 0) {
      throw new Error('Invalid request: missing or empty content array in input[0]');
    }

    const firstContent = firstInput.content[0];
    if (!firstContent.text || typeof firstContent.text !== 'string') {
      throw new Error('Invalid request: missing or non-string text field in input[0].content[0]');
    }

    // Extract fields from standard request format
    const content = firstContent.text;

    // Extract session_id directly from metadata (Requirement 1.1, 2.7)
    // server sends metadata.session_id; fallback to a generated ID if absent
    const sessionId: string =
      (request.metadata?.session_id && typeof request.metadata.session_id === 'string')
        ? request.metadata.session_id
        : generateMessageId(); // anonymous session

    const stream = request.stream !== undefined ? request.stream : true; // Default to true if missing
    const model = request.model; // Optional field

    // Generate message ID (or extract from metadata if available)
    const messageId = request.metadata?.message_id || generateMessageId();

    // Log parsed request with session information (Requirement 7.1)
    // Note: Logger is not available in protocol.ts, logging will be done in connection.ts
    
    // Return RequestContent with all extracted fields (Requirement 1.5)
    return {
      content,
      messageId,
      sessionId,
      stream,
      model,
      topic: TOPIC_USER_MESSAGES, // Keep for backward compatibility
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      const preview = rawMessage.substring(0, 100);
      throw new Error(`Failed to parse standard request: ${error.message}. Raw: ${preview}`);
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
// Event Serialization (open-responses.md §7)
//
// Directly serializes Open Responses events to JSON without envelope wrapping.
// Per the updated protocol specification, events are sent as standard JSON objects.
// ============================================================================

/**
 * Serialize an Open Responses event to JSON string.
 *
 * Directly returns the JSON serialization of the event without envelope wrapping,
 * as required by the standard protocol format in open-responses.md.
 *
 * Validates: Requirements 2.2
 */
export function createEnvelope(event: OpenResponsesEvent): string {
  return JSON.stringify(event);
}

// ============================================================================
// Event Creation Helpers (open-responses.md §6)
// ============================================================================

/**
 * Create a response.in_progress event.  (§6.1)
 */
export function createInProgressEvent(responseId: string, sessionId?: string): ResponseInProgressEvent {
  const event: ResponseInProgressEvent = {
    type: 'response.in_progress',
    response_id: responseId,
    status: 'in_progress',
    timestamp: isoNow(),
  };
  
  // Include metadata with session_id if provided (Requirement 2.3)
  if (sessionId) {
    (event as any).metadata = { session_id: sessionId };
  }
  
  return event;
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
export function createCompletedEvent(responseId: string, sessionId?: string): ResponseCompletedEvent {
  const event: ResponseCompletedEvent = {
    type: 'response.completed',
    response_id: responseId,
    status: 'completed',
    timestamp: isoNow(),
  };
  
  // Include metadata with session_id if provided (Requirement 2.3)
  if (sessionId) {
    (event as any).metadata = { session_id: sessionId };
  }
  
  return event;
}

/**
 * Create a response.failed event.  (§6.6)
 */
export function createFailedEvent(
  responseId: string,
  code: string,
  message: string,
  details: any = null,
  sessionId?: string
): ResponseFailedEvent {
  const event: ResponseFailedEvent = {
    type: 'response.failed',
    response_id: responseId,
    status: 'failed',
    error: { code, message, details },
    timestamp: isoNow(),
  };

  if (sessionId) {
    (event as any).metadata = { session_id: sessionId };
  }

  return event;
}

/**
 * Create a complete response object for non-streaming mode (stream=false).
 * 
 * Returns a complete response object with all fields populated,
 * including id, object, status, output, output_text, and metadata.
 * 
 * Validates: Requirements 2.5
 */
export function createCompleteResponse(
  responseId: string,
  itemId: string,
  text: string,
  sessionId: string
): any {
  return {
    id: responseId,
    object: 'response',
    status: 'completed',
    output: {
      items: [
        {
          id: itemId,
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              status: 'completed',
              text: text,
            },
          ],
        },
      ],
    },
    output_text: text,
    metadata: {
      session_id: sessionId,
    },
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
