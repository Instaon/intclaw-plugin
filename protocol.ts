/**
 * Protocol Handler Module
 * 
 * This module implements the Open Responses protocol for the InstaClaw Connector.
 * It provides functions for parsing and creating WebSocket Envelope messages,
 * generating Open Responses events, and converting text to event sequences.
 * 
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 10.2, 8.3
 */

import { randomUUID } from 'crypto';
import type {
  WebSocketEnvelope,
  OpenResponsesEvent,
  ResponseInProgressEvent,
  OutputItemAddedEvent,
  OutputTextDeltaEvent,
  ResponseCompletedEvent,
  Item,
} from './types.js';
import { TEXT_CHUNK_SIZE } from './config.js';

// ============================================================================
// Envelope Parsing Functions (Task 4.1)
// ============================================================================

/**
 * Parse a WebSocket Envelope and extract the Open Responses event
 * 
 * This function parses the raw WebSocket message (JSON string), validates the
 * envelope structure, and extracts the embedded Open Responses event from the
 * data field.
 * 
 * Validates: Requirements 11.1, 11.2, 11.3, 11.8
 * 
 * @param rawMessage - Raw JSON string from WebSocket
 * @returns Parsed Open Responses event object
 * @throws {Error} If parsing fails or required fields are missing
 */
export function parseEnvelope(rawMessage: string): OpenResponsesEvent {
  try {
    // Parse outer envelope
    const envelope = JSON.parse(rawMessage) as WebSocketEnvelope;
    
    // Validate required envelope fields
    if (!envelope.type || typeof envelope.type !== 'string') {
      throw new Error('Invalid envelope: missing or invalid type field');
    }
    
    if (!envelope.data || typeof envelope.data !== 'string') {
      throw new Error('Invalid envelope: missing or invalid data field');
    }
    
    if (!envelope.headers || typeof envelope.headers !== 'object') {
      throw new Error('Invalid envelope: missing or invalid headers field');
    }
    
    // Parse inner event from data field
    const event = JSON.parse(envelope.data) as OpenResponsesEvent;
    
    // Validate required event fields
    if (!event.type || typeof event.type !== 'string') {
      throw new Error('Invalid event: missing or invalid type field');
    }
    
    if (!event.event_id || typeof event.event_id !== 'string') {
      throw new Error('Invalid event: missing or invalid event_id field');
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
// Envelope Creation Functions (Task 4.2)
// ============================================================================

/**
 * Generate a unique message ID for WebSocket Envelope
 * 
 * Validates: Requirements 11.6
 * 
 * @returns Unique message identifier in format "msg_<timestamp>_<random>"
 */
function generateMessageId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `msg_${timestamp}_${random}`;
}

/**
 * Create a WebSocket Envelope from an Open Responses event
 * 
 * This function wraps an Open Responses event in a WebSocket Envelope format,
 * generating a unique message ID and serializing the event to JSON.
 * 
 * Validates: Requirements 11.4, 11.5, 11.6
 * 
 * @param event - Open Responses event to wrap
 * @returns JSON string of WebSocket Envelope
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
// Event Creation Helper Functions (Task 4.3)
// ============================================================================

/**
 * Generate a unique event ID
 * 
 * Validates: Requirements 10.2
 * 
 * @returns Unique event identifier in format "evt_<timestamp>_<random>"
 */
function generateEventId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `evt_${timestamp}_${random}`;
}

/**
 * Create a response.in_progress event
 * 
 * Validates: Requirements 10.2
 * 
 * @param responseId - Unique response identifier
 * @returns ResponseInProgressEvent object
 */
export function createInProgressEvent(responseId: string): ResponseInProgressEvent {
  return {
    type: 'response.in_progress',
    event_id: generateEventId(),
    response_id: responseId,
  };
}

/**
 * Create a response.output_item.added event
 * 
 * Validates: Requirements 10.2
 * 
 * @param responseId - Unique response identifier
 * @param itemId - Unique item identifier
 * @returns OutputItemAddedEvent object
 */
export function createOutputItemAddedEvent(
  responseId: string,
  itemId: string
): OutputItemAddedEvent {
  return {
    type: 'response.output_item.added',
    event_id: generateEventId(),
    response_id: responseId,
    item: {
      id: itemId,
      type: 'message',
      content: [{ type: 'text', text: '' }],
    },
  };
}

/**
 * Create a response.output_text.delta event
 * 
 * Validates: Requirements 10.2
 * 
 * @param responseId - Unique response identifier
 * @param itemId - Unique item identifier
 * @param contentIndex - Index of the content part
 * @param text - Text delta to append
 * @returns OutputTextDeltaEvent object
 */
export function createOutputTextDeltaEvent(
  responseId: string,
  itemId: string,
  contentIndex: number,
  text: string
): OutputTextDeltaEvent {
  return {
    type: 'response.output_text.delta',
    event_id: generateEventId(),
    response_id: responseId,
    item_id: itemId,
    content_index: contentIndex,
    delta: { text },
  };
}

/**
 * Create a response.completed event
 * 
 * Validates: Requirements 10.2
 * 
 * @param responseId - Unique response identifier
 * @returns ResponseCompletedEvent object
 */
export function createCompletedEvent(responseId: string): ResponseCompletedEvent {
  return {
    type: 'response.completed',
    event_id: generateEventId(),
    response_id: responseId,
  };
}

// ============================================================================
// Text to Event Sequence Conversion (Task 4.4)
// ============================================================================

/**
 * Convert text message to Open Responses event sequence
 * 
 * This function generates a complete event sequence for sending a text message:
 * 1. response.in_progress - Indicates response has started
 * 2. response.output_item.added - Adds a message item
 * 3. response.output_text.delta (multiple) - Streams text in chunks
 * 4. response.completed - Indicates response is complete
 * 
 * Validates: Requirements 8.3
 * 
 * @param text - Text message to convert
 * @param responseId - Optional response ID (generated if not provided)
 * @returns Array of Open Responses events
 */
export function textToEventSequence(text: string, responseId?: string): OpenResponsesEvent[] {
  const respId = responseId || `resp_${Date.now()}`;
  const itemId = `item_${Date.now()}`;
  
  const events: OpenResponsesEvent[] = [
    createInProgressEvent(respId),
    createOutputItemAddedEvent(respId, itemId),
  ];
  
  // Split text into chunks for streaming effect
  for (let i = 0; i < text.length; i += TEXT_CHUNK_SIZE) {
    const chunk = text.substring(i, i + TEXT_CHUNK_SIZE);
    events.push(createOutputTextDeltaEvent(respId, itemId, 0, chunk));
  }
  
  events.push(createCompletedEvent(respId));
  
  return events;
}
