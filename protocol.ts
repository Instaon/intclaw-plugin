/**
 * Protocol Handler Module
 * 
 * This module implements the Open Responses protocol for the InstaClaw Connector.
 * It provides functions for parsing and creating WebSocket Envelope messages,
 * generating Open Responses events, and converting text to event sequences.
 * 
 * ## Protocol Flow Overview
 * 
 * The InstaClaw Connector plugin acts as a **request responder** (not an active sender).
 * The correct interaction pattern follows the request-response model:
 * 
 * ### Request-Response Flow:
 * 
 * 1. **Server sends request** → Plugin receives WebSocket Envelope containing request
 *    - Envelope format: { type: "request", headers: {...}, data: JSON.stringify(requestContent) }
 *    - Request content: { type: "user.message", content: "...", userId: "..." }
 * 
 * 2. **Plugin parses request** → Extract and validate request content
 *    - Use parseRequest() to extract request from Envelope
 *    - Validate request structure and extract user message
 * 
 * 3. **Plugin generates response** → Create Open Responses event sequence
 *    - Use generateResponseSequence() to create event sequence
 *    - Event sequence: response.in_progress → response.output_item.added → 
 *                      response.output_text.delta (multiple) → response.completed
 * 
 * 4. **Plugin sends response** → Wrap each event in Envelope and send via WebSocket
 *    - Use createEnvelope() to wrap each event
 *    - Each event is sent independently in its own Envelope
 *    - Envelope.data MUST be a JSON string (JSON.stringify(event))
 * 
 * ### Key Principles:
 * 
 * - **Plugin Role**: The plugin is a request responder, not an active sender
 * - **Message Direction**: Server → Plugin (request), Plugin → Server (response events)
 * - **Envelope Format**: All messages wrapped in WebSocket Envelope with JSON string data field
 * - **Event Sequence**: Each response generates a complete Open Responses event sequence
 * - **Unified Module**: All protocol logic centralized in this module for consistency
 * 
 * ### WebSocket Envelope Format:
 * 
 * ```typescript
 * {
 *   type: "message" | "control" | "request",
 *   headers: {
 *     messageId: string,      // Unique message identifier
 *     timestamp: number,      // Unix timestamp in milliseconds
 *     requestId?: string,     // Optional request identifier
 *     [key: string]: any      // Additional headers
 *   },
 *   data: string              // MUST be JSON string (JSON.stringify)
 * }
 * ```
 * 
 * ### Open Responses Event Sequence:
 * 
 * ```typescript
 * // 1. Response starts
 * { type: "response.in_progress", event_id: "...", response_id: "..." }
 * 
 * // 2. Output item added
 * { type: "response.output_item.added", event_id: "...", response_id: "...", item: {...} }
 * 
 * // 3. Text streaming (multiple events)
 * { type: "response.output_text.delta", event_id: "...", response_id: "...", 
 *   item_id: "...", content_index: 0, delta: { text: "..." } }
 * 
 * // 4. Response completes
 * { type: "response.completed", event_id: "...", response_id: "..." }
 * ```
 * 
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 10.2, 8.3, 2.1, 2.2, 2.3, 2.4, 2.5
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
  RequestContent,
} from './types';
import { TEXT_CHUNK_SIZE } from './config';

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

// ============================================================================
// Request Parsing Functions (Task 3.1)
// ============================================================================

/**
 * Parse a server request from WebSocket Envelope
 * 
 * This function extracts and validates a request message sent from the server.
 * The server sends requests to the plugin, and the plugin responds with
 * Open Responses event sequences.
 * 
 * Validates: Requirements 2.1, 2.4
 * 
 * @param rawMessage - Raw JSON string from WebSocket containing request
 * @returns Parsed request content
 * @throws {Error} If parsing fails or request format is invalid
 */
export function parseRequest(rawMessage: string): RequestContent {
  try {
    // Parse outer envelope
    const envelope = JSON.parse(rawMessage) as WebSocketEnvelope;
    
    // Validate envelope structure
    if (!envelope.type || typeof envelope.type !== 'string') {
      throw new Error('Invalid request envelope: missing or invalid type field');
    }
    
    if (!envelope.data || typeof envelope.data !== 'string') {
      throw new Error('Invalid request envelope: missing or invalid data field');
    }
    
    if (!envelope.headers || typeof envelope.headers !== 'object') {
      throw new Error('Invalid request envelope: missing or invalid headers field');
    }
    
    // Parse request content from data field
    const requestData = JSON.parse(envelope.data);
    
    // Validate request content structure
    if (!requestData.type || typeof requestData.type !== 'string') {
      throw new Error('Invalid request content: missing or invalid type field');
    }
    
    if (!requestData.content || typeof requestData.content !== 'string') {
      throw new Error('Invalid request content: missing or invalid content field');
    }
    
    if (!requestData.userId || typeof requestData.userId !== 'string') {
      throw new Error('Invalid request content: missing or invalid userId field');
    }
    
    // Extract request ID from headers if available
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
// Response Generation Functions (Task 3.1)
// ============================================================================

/**
 * Generate Open Responses event sequence from request
 * 
 * This function creates a complete Open Responses event sequence in response
 * to a server request. The sequence includes:
 * 1. response.in_progress - Indicates response has started
 * 2. response.output_item.added - Adds a message item
 * 3. response.output_text.delta (multiple) - Streams response text in chunks
 * 4. response.completed - Indicates response is complete
 * 
 * This is the primary function for generating responses as a request responder.
 * 
 * Validates: Requirements 2.2, 2.3, 2.5
 * 
 * @param request - Parsed request content from server
 * @param responseText - Text content to send as response
 * @returns Array of Open Responses events forming complete response sequence
 */
export function generateResponseSequence(
  request: RequestContent,
  responseText: string
): OpenResponsesEvent[] {
  // Generate unique identifiers for this response
  const responseId = `resp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const itemId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  
  // Build event sequence
  const events: OpenResponsesEvent[] = [
    // 1. Signal response has started
    createInProgressEvent(responseId),
    
    // 2. Add output item (message container)
    createOutputItemAddedEvent(responseId, itemId),
  ];
  
  // 3. Stream response text in chunks
  for (let i = 0; i < responseText.length; i += TEXT_CHUNK_SIZE) {
    const chunk = responseText.substring(i, i + TEXT_CHUNK_SIZE);
    events.push(createOutputTextDeltaEvent(responseId, itemId, 0, chunk));
  }
  
  // 4. Signal response is complete
  events.push(createCompletedEvent(responseId));
  
  return events;
}
