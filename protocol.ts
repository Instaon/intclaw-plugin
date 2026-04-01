/**
 * Protocol Handler Module
 *
 * Implements the Open Responses protocol for the InstaClaw Connector.
 * All event structures strictly follow open-responses.md.
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 10.2, 8.3, 2.1, 2.2, 2.3, 2.4, 2.5
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
} from './types';
import { TEXT_CHUNK_SIZE } from './config';

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
// Envelope Parsing (Task 4.1)
// ============================================================================

/**
 * Parse a WebSocket Envelope and extract the Open Responses event.
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.8
 */
export function parseEnvelope(rawMessage: string): OpenResponsesEvent {
  try {
    const envelope = JSON.parse(rawMessage) as WebSocketEnvelope;

    if (!envelope.type || typeof envelope.type !== 'string') {
      throw new Error('Invalid envelope: missing or invalid type field');
    }

    if (!envelope.data || typeof envelope.data !== 'string') {
      throw new Error('Invalid envelope: missing or invalid data field');
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
// Envelope Creation (Task 4.2)
// ============================================================================

/**
 * Create a WebSocket Envelope from an Open Responses event.
 *
 * Validates: Requirements 11.4, 11.5, 11.6
 */
export function createEnvelope(event: OpenResponsesEvent): string {
  const envelope: WebSocketEnvelope = {
    type: "message",
    headers: {
      messageId: generateMessageId(),
      timestamp: Date.now(),
    },
    data: JSON.stringify(event),
  };

  return JSON.stringify(envelope);
}

// ============================================================================
// Event Creation Helpers (Task 4.3)
// ============================================================================

/**
 * Create a response.in_progress event.
 *
 * Validates: Requirements 10.2
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
 * Create a response.output_item.added event.
 *
 * Validates: Requirements 10.2
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
 * Create a response.output_text.delta event.
 *
 * Validates: Requirements 10.2
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
 * Create a response.content_part.done event.
 *
 * Validates: Requirements 10.2
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
 * Create a response.completed event.
 *
 * Validates: Requirements 10.2
 */
export function createCompletedEvent(responseId: string): ResponseCompletedEvent {
  return {
    type: 'response.completed',
    response_id: responseId,
    status: 'completed',
    timestamp: isoNow(),
  };
}

// ============================================================================
// Text to Event Sequence Conversion (Task 4.4)
// ============================================================================

/**
 * Convert text message to Open Responses event sequence.
 *
 * Generates: in_progress → output_item.added → output_text.delta (N) → content_part.done → completed
 *
 * Validates: Requirements 8.3
 */
export function textToEventSequence(text: string, responseId?: string): OpenResponsesEvent[] {
  const respId = responseId || `resp_${Date.now()}`;
  const itemId = `item_${Date.now()}`;

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
// Request Parsing (Task 3.1)
// ============================================================================

/**
 * Parse a server request from WebSocket Envelope.
 *
 * Validates: Requirements 2.1, 2.4
 */
export function parseRequest(rawMessage: string): RequestContent {
  try {
    const envelope = JSON.parse(rawMessage) as WebSocketEnvelope;

    if (!envelope.type || typeof envelope.type !== 'string') {
      throw new Error('Invalid request envelope: missing or invalid type field');
    }

    if (!envelope.data || typeof envelope.data !== 'string') {
      throw new Error('Invalid request envelope: missing or invalid data field');
    }

    if (!envelope.headers || typeof envelope.headers !== 'object') {
      throw new Error('Invalid request envelope: missing or invalid headers field');
    }

    const requestData = JSON.parse(envelope.data);

    if (!requestData.type || typeof requestData.type !== 'string') {
      throw new Error('Invalid request content: missing or invalid type field');
    }

    if (!requestData.content || typeof requestData.content !== 'string') {
      throw new Error('Invalid request content: missing or invalid content field');
    }

    if (!requestData.userId || typeof requestData.userId !== 'string') {
      throw new Error('Invalid request content: missing or invalid userId field');
    }

    const requestId = envelope.headers['requestId'] || envelope.headers.messageId;

    return {
      type: requestData.type,
      content: requestData.content,
      userId: requestData.userId,
      requestId,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      const preview = rawMessage.substring(0, 100);
      throw new Error(`Failed to parse request: ${error.message}. Raw: ${preview}`);
    }
    throw error;
  }
}

// ============================================================================
// Response Generation (Task 3.1)
// ============================================================================

/**
 * Generate Open Responses event sequence from request.
 *
 * Validates: Requirements 2.2, 2.3, 2.5
 */
export function generateResponseSequence(
  request: RequestContent,
  responseText: string
): OpenResponsesEvent[] {
  const responseId = `resp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const itemId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  const events: OpenResponsesEvent[] = [
    createInProgressEvent(responseId),
    createOutputItemAddedEvent(responseId, itemId),
  ];

  for (let i = 0; i < responseText.length; i += TEXT_CHUNK_SIZE) {
    const chunk = responseText.substring(i, i + TEXT_CHUNK_SIZE);
    events.push(createOutputTextDeltaEvent(responseId, itemId, 0, chunk));
  }

  events.push(createContentPartDoneEvent(responseId, itemId, 0));
  events.push(createCompletedEvent(responseId));

  return events;
}
