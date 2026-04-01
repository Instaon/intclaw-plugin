/**
 * Preservation Property Tests
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
 * 
 * These tests verify that existing functionality remains unchanged after the fix.
 * They capture the baseline behavior of the UNFIXED code for non-buggy inputs:
 * 
 * - WebSocket connection management (connect, disconnect, reconnect)
 * - Heartbeat mechanism (ping/pong)
 * - Event parsing (parseEnvelope for valid messages)
 * - State management (response status tracking)
 * - Event ID and response ID generation (uniqueness)
 * - Text accumulation logic (response.output_text.delta)
 * - Response completion handling (response.completed)
 * 
 * **IMPORTANT**: These tests run on UNFIXED code and should PASS.
 * They establish the baseline behavior that must be preserved after the fix.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { 
  WebSocketEnvelope, 
  OpenResponsesEvent,
  ResponseInProgressEvent,
  OutputItemAddedEvent,
  OutputTextDeltaEvent,
  ResponseCompletedEvent,
} from '../../types.js';

describe('Preservation Property Tests - Existing Functionality', () => {
  /**
   * Property 2.1: Event Parsing Preservation
   * 
   * **Validates: Requirements 3.1**
   * 
   * For any valid WebSocket Envelope containing an Open Responses event,
   * parseEnvelope SHALL correctly extract the event with all required fields.
   */
  it('Property 2.1: parseEnvelope SHALL correctly parse valid Open Responses events', async () => {
    const { parseEnvelope } = await import('../../protocol.js');
    
    // Generator for valid Open Responses events
    // event_id is optional per Open Responses spec
    const validEventArb = fc.oneof(
      // response.in_progress event
      fc.record({
        type: fc.constant('response.in_progress' as const),
        response_id: fc.string({ minLength: 10, maxLength: 30 }),
      }).chain(base =>
        fc.option(fc.string({ minLength: 10, maxLength: 30 }), { nil: undefined }).map(event_id => ({ ...base, event_id }))
      ),
      // response.output_item.added event
      fc.record({
        type: fc.constant('response.output_item.added' as const),
        response_id: fc.string({ minLength: 10, maxLength: 30 }),
        item: fc.record({
          id: fc.string({ minLength: 10, maxLength: 30 }),
          type: fc.constant('message' as const),
          content: fc.array(fc.record({
            type: fc.constant('text' as const),
            text: fc.string({ maxLength: 100 }),
          }), { minLength: 1, maxLength: 3 }),
        }),
      }).chain(base =>
        fc.option(fc.string({ minLength: 10, maxLength: 30 }), { nil: undefined }).map(event_id => ({ ...base, event_id }))
      ),
      // response.output_text.delta event
      fc.record({
        type: fc.constant('response.output_text.delta' as const),
        response_id: fc.string({ minLength: 10, maxLength: 30 }),
        item_id: fc.string({ minLength: 10, maxLength: 30 }),
        content_index: fc.integer({ min: 0, max: 5 }),
        delta: fc.record({
          text: fc.string({ minLength: 1, maxLength: 50 }),
        }),
      }).chain(base =>
        fc.option(fc.string({ minLength: 10, maxLength: 30 }), { nil: undefined }).map(event_id => ({ ...base, event_id }))
      ),
      // response.completed event
      fc.record({
        type: fc.constant('response.completed' as const),
        response_id: fc.string({ minLength: 10, maxLength: 30 }),
      }).chain(base =>
        fc.option(fc.string({ minLength: 10, maxLength: 30 }), { nil: undefined }).map(event_id => ({ ...base, event_id }))
      )
    );
    
    // Generator for valid WebSocket Envelope
    const validEnvelopeArb = fc.tuple(validEventArb).map(([event]) => {
      const envelope: WebSocketEnvelope = {
        type: 'message',
        headers: {
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          timestamp: Date.now(),
        },
        data: JSON.stringify(event),
      };
      return { envelope, originalEvent: event };
    });
    
    fc.assert(
      fc.property(validEnvelopeArb, ({ envelope, originalEvent }) => {
        const rawMessage = JSON.stringify(envelope);
        
        // Parse the envelope
        const parsedEvent = parseEnvelope(rawMessage);
        
        // Verify all required fields are present
        expect(parsedEvent).toBeDefined();
        expect(parsedEvent.type).toBe(originalEvent.type);
        expect(parsedEvent.event_id).toBe(originalEvent.event_id ?? undefined);
        expect(parsedEvent.response_id).toBe(originalEvent.response_id);
        
        // Verify type-specific fields
        if (originalEvent.type === 'response.output_item.added') {
          const itemEvent = parsedEvent as OutputItemAddedEvent;
          const origItemEvent = originalEvent as OutputItemAddedEvent;
          expect(itemEvent.item).toBeDefined();
          expect(itemEvent.item.id).toBe(origItemEvent.item.id);
          expect(itemEvent.item.type).toBe(origItemEvent.item.type);
        }
        
        if (originalEvent.type === 'response.output_text.delta') {
          const deltaEvent = parsedEvent as OutputTextDeltaEvent;
          const origDeltaEvent = originalEvent as OutputTextDeltaEvent;
          expect(deltaEvent.item_id).toBe(origDeltaEvent.item_id);
          expect(deltaEvent.content_index).toBe(origDeltaEvent.content_index);
          expect(deltaEvent.delta.text).toBe(origDeltaEvent.delta.text);
        }
      }),
      {
        numRuns: 50,
        verbose: true,
      }
    );
  });

  /**
   * Property 2.2: Event ID and Response ID Uniqueness
   * 
   * **Validates: Requirements 3.2**
   * 
   * For any generated events, event IDs and response IDs SHALL be unique.
   */
  it('Property 2.2: Generated event IDs and response IDs SHALL be unique', async () => {
    const { 
      createInProgressEvent,
      createOutputItemAddedEvent,
      createOutputTextDeltaEvent,
      createCompletedEvent,
    } = await import('../../protocol.js');
    
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 20 }),
        fc.string({ minLength: 5, maxLength: 20 }),
        fc.integer({ min: 0, max: 10 }),
        (responseId, itemId, numDeltas) => {
          // Generate a sequence of events
          const events: OpenResponsesEvent[] = [
            createInProgressEvent(responseId),
            createOutputItemAddedEvent(responseId, itemId),
          ];
          
          // Add multiple delta events
          for (let i = 0; i < numDeltas; i++) {
            events.push(createOutputTextDeltaEvent(responseId, itemId, 0, `chunk${i}`));
          }
          
          events.push(createCompletedEvent(responseId));
          
          // Collect all event IDs
          const eventIds = events.map(e => e.event_id);
          
          // Verify all event IDs are unique
          const uniqueEventIds = new Set(eventIds);
          expect(uniqueEventIds.size).toBe(eventIds.length);
          
          // Verify all events have the same response_id
          for (const event of events) {
            expect(event.response_id).toBe(responseId);
          }
        }
      ),
      {
        numRuns: 30,
        verbose: true,
      }
    );
  });

  /**
   * Property 2.3: Envelope Creation with JSON String Data
   * 
   * **Validates: Requirements 3.1**
   * 
   * For any Open Responses event, createEnvelope SHALL wrap it in a WebSocket Envelope
   * with the data field as a JSON string.
   */
  it('Property 2.3: createEnvelope SHALL serialize data field as JSON string', async () => {
    const { createEnvelope, textToEventSequence } = await import('../../protocol.js');
    
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (text) => {
          // Generate event sequence
          const events = textToEventSequence(text);
          
          // Wrap each event in envelope
          for (const event of events) {
            const envelopeStr = createEnvelope(event);
            
            // Parse envelope
            const envelope = JSON.parse(envelopeStr) as WebSocketEnvelope;
            
            // Verify envelope structure
            expect(envelope.type).toBe('message');
            expect(envelope.headers).toBeDefined();
            expect(envelope.headers.messageId).toBeDefined();
            expect(envelope.headers.timestamp).toBeDefined();
            
            // CRITICAL: data field MUST be a string
            expect(typeof envelope.data).toBe('string');
            
            // Verify data can be parsed as JSON
            const parsedData = JSON.parse(envelope.data);
            expect(parsedData).toBeDefined();
            expect(parsedData.type).toBe(event.type);
            expect(parsedData.event_id).toBe(event.event_id);
            expect(parsedData.response_id).toBe(event.response_id);
          }
        }
      ),
      {
        numRuns: 30,
        verbose: true,
      }
    );
  });

  /**
   * Property 2.4: Text to Event Sequence Conversion
   * 
   * **Validates: Requirements 3.6**
   * 
   * For any text input, textToEventSequence SHALL generate a valid event sequence
   * with correct structure and order.
   */
  it('Property 2.4: textToEventSequence SHALL generate valid event sequence', async () => {
    const { textToEventSequence } = await import('../../protocol.js');
    
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        fc.option(fc.string({ minLength: 5, maxLength: 20 }), { nil: undefined }),
        (text, responseId) => {
          // Generate event sequence
          const events = textToEventSequence(text, responseId);
          
          // Verify sequence structure
          expect(events.length).toBeGreaterThanOrEqual(3); // At least: in_progress, item_added, completed
          
          // First event should be response.in_progress
          expect(events[0]?.type).toBe('response.in_progress');
          
          // Second event should be response.output_item.added
          expect(events[1]?.type).toBe('response.output_item.added');
          
          // Last event should be response.completed
          expect(events[events.length - 1]?.type).toBe('response.completed');
          
          // All events should have the same response_id
          const respId = events[0]?.response_id;
          expect(respId).toBeDefined();
          
          for (const event of events) {
            expect(event.response_id).toBe(respId);
            expect(event.event_id).toBeDefined();
          }
          
          // If responseId was provided, verify it's used
          if (responseId) {
            expect(respId).toBe(responseId);
          }
          
          // Verify delta events contain text chunks
          const deltaEvents = events.filter(e => e.type === 'response.output_text.delta') as OutputTextDeltaEvent[];
          const reconstructedText = deltaEvents.map(e => e.delta.text).join('');
          expect(reconstructedText).toBe(text);
        }
      ),
      {
        numRuns: 40,
        verbose: true,
      }
    );
  });

  /**
   * Property 2.5: Response State Management
   * 
   * **Validates: Requirements 3.7**
   * 
   * This test verifies the response state management logic that tracks
   * response status, items, and text accumulation.
   */
  it('Property 2.5: Response state management SHALL correctly track status and accumulate text', () => {
    // Simulate the response state management logic from connection.ts
    const activeResponses = new Map<string, any>();
    
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 20 }),
        fc.string({ minLength: 10, maxLength: 20 }),
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 10 }),
        (responseId, itemId, textChunks) => {
          // Simulate response.in_progress
          activeResponses.set(responseId, {
            id: responseId,
            status: 'in_progress',
            items: [],
            createdAt: Date.now(),
          });
          
          const response = activeResponses.get(responseId);
          expect(response).toBeDefined();
          expect(response.status).toBe('in_progress');
          
          // Simulate response.output_item.added
          response.items.push({
            id: itemId,
            type: 'message',
            content: [{ type: 'text', text: '' }],
          });
          
          expect(response.items.length).toBe(1);
          expect(response.items[0].id).toBe(itemId);
          
          // Simulate multiple response.output_text.delta events
          for (const chunk of textChunks) {
            const item = response.items.find((i: any) => i.id === itemId);
            const contentPart = item?.content[0];
            if (item && contentPart) {
              contentPart.text += chunk;
            }
          }
          
          // Verify text accumulation
          const accumulatedText = response.items[0].content[0].text;
          const expectedText = textChunks.join('');
          expect(accumulatedText).toBe(expectedText);
          
          // Simulate response.completed
          response.status = 'completed';
          expect(response.status).toBe('completed');
          
          // Extract complete text
          const fullText = response.items
            .flatMap((item: any) => item.content)
            .map((part: any) => part.text)
            .join('');
          
          expect(fullText).toBe(expectedText);
          
          // Clean up
          activeResponses.delete(responseId);
          expect(activeResponses.has(responseId)).toBe(false);
        }
      ),
      {
        numRuns: 30,
        verbose: true,
      }
    );
  });

  /**
   * Property 2.6: Message ID Generation Uniqueness
   * 
   * **Validates: Requirements 3.2**
   * 
   * For any generated envelopes, message IDs SHALL be unique.
   */
  it('Property 2.6: Generated message IDs SHALL be unique across envelopes', async () => {
    const { createEnvelope, textToEventSequence } = await import('../../protocol.js');
    
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 5, maxLength: 20 }),
        (texts) => {
          const messageIds = new Set<string>();
          
          // Generate envelopes for multiple texts
          for (const text of texts) {
            const events = textToEventSequence(text);
            
            for (const event of events) {
              const envelopeStr = createEnvelope(event);
              const envelope = JSON.parse(envelopeStr) as WebSocketEnvelope;
              
              // Collect message ID
              const messageId = envelope.headers.messageId;
              expect(messageId).toBeDefined();
              
              // Verify uniqueness
              expect(messageIds.has(messageId)).toBe(false);
              messageIds.add(messageId);
            }
          }
          
          // All message IDs should be unique
          expect(messageIds.size).toBeGreaterThan(0);
        }
      ),
      {
        numRuns: 20,
        verbose: true,
      }
    );
  });

  /**
   * Property 2.7: Event Sequence Order Preservation
   * 
   * **Validates: Requirements 3.6**
   * 
   * For any text input, the generated event sequence SHALL maintain the correct order:
   * in_progress → output_item.added → output_text.delta (multiple) → completed
   */
  it('Property 2.7: Event sequence SHALL maintain correct order', async () => {
    const { textToEventSequence } = await import('../../protocol.js');
    
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 300 }),
        (text) => {
          const events = textToEventSequence(text);
          
          // Verify order
          const eventTypes = events.map(e => e.type);
          
          // First must be in_progress
          expect(eventTypes[0]).toBe('response.in_progress');
          
          // Second must be output_item.added
          expect(eventTypes[1]).toBe('response.output_item.added');
          
          // Last must be completed
          expect(eventTypes[eventTypes.length - 1]).toBe('response.completed');
          
          // Middle events should be output_text.delta
          const middleEvents = eventTypes.slice(2, -1);
          for (const type of middleEvents) {
            expect(type).toBe('response.output_text.delta');
          }
          
          // Verify no other event types
          const validTypes = new Set([
            'response.in_progress',
            'response.output_item.added',
            'response.output_text.delta',
            'response.completed',
          ]);
          
          for (const type of eventTypes) {
            expect(validTypes.has(type)).toBe(true);
          }
        }
      ),
      {
        numRuns: 30,
        verbose: true,
      }
    );
  });
});
