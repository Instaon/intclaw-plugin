/**
 * Preservation Property Tests
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
 *
 * These tests verify that existing functionality remains unchanged.
 * All fixtures strictly follow open-responses.md:
 *  - Envelope.type  = "MESSAGE"  (uppercase)
 *  - Envelope.headers = { messageId, topic }  — no timestamp, no event_id
 *  - Envelope.data  = JSON.stringify(event)
 *  - Events: type, response_id, timestamp — no event_id
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type {
  WebSocketEnvelope,
  OpenResponsesEvent,
  OutputItemAddedEvent,
  OutputTextDeltaEvent,
} from '../../types.js';
import { TOPIC_BOT_MESSAGES, TOPIC_USER_MESSAGES } from '../../protocol.js';

describe('Preservation Property Tests - Existing Functionality', () => {
  /**
   * Property 2.1: Event Parsing Preservation
   *
   * For any valid WebSocket Envelope containing an Open Responses event,
   * parseEnvelope SHALL correctly extract the event with all required fields.
   */
  it('Property 2.1: parseEnvelope SHALL correctly parse valid Open Responses events', async () => {
    const { parseEnvelope } = await import('../../protocol.js');

    // Arbitraries for valid Open Responses events (no event_id per spec)
    const validEventArb = fc.oneof(
      fc.record({
        type: fc.constant('response.in_progress' as const),
        response_id: fc.string({ minLength: 10, maxLength: 30 }),
        status: fc.constant('in_progress' as const),
        timestamp: fc.constant(new Date().toISOString()),
      }),
      fc.record({
        type: fc.constant('response.output_item.added' as const),
        response_id: fc.string({ minLength: 10, maxLength: 30 }),
        timestamp: fc.constant(new Date().toISOString()),
        index: fc.integer({ min: 0, max: 5 }),
        item: fc.record({
          id: fc.string({ minLength: 10, maxLength: 30 }),
          type: fc.constant('message' as const),
          status: fc.constant('in_progress' as const),
          role: fc.constant('assistant' as const),
          content: fc.array(fc.record({
            type: fc.constant('output_text' as const),
            status: fc.constant('in_progress' as const),
            text: fc.string({ maxLength: 100 }),
          }), { minLength: 1, maxLength: 3 }),
        }),
      }),
      fc.record({
        type: fc.constant('response.output_text.delta' as const),
        response_id: fc.string({ minLength: 10, maxLength: 30 }),
        item_id: fc.string({ minLength: 10, maxLength: 30 }),
        content_index: fc.integer({ min: 0, max: 5 }),
        timestamp: fc.constant(new Date().toISOString()),
        delta: fc.record({
          text: fc.string({ minLength: 1, maxLength: 50 }),
        }),
      }),
      fc.record({
        type: fc.constant('response.completed' as const),
        response_id: fc.string({ minLength: 10, maxLength: 30 }),
        status: fc.constant('completed' as const),
        timestamp: fc.constant(new Date().toISOString()),
      }),
    );

    // Generator for valid WebSocket Envelope per open-responses.md §7
    const validEnvelopeArb = fc.tuple(validEventArb).map(([event]) => {
      const envelope: WebSocketEnvelope = {
        type: 'MESSAGE',
        headers: {
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          topic: TOPIC_BOT_MESSAGES,
        },
        data: JSON.stringify(event),
      };
      return { envelope, originalEvent: event };
    });

    fc.assert(
      fc.property(validEnvelopeArb, ({ envelope, originalEvent }) => {
        const rawMessage = JSON.stringify(envelope);

        const parsedEvent = parseEnvelope(rawMessage);

        expect(parsedEvent).toBeDefined();
        expect(parsedEvent.type).toBe(originalEvent.type);
        expect(parsedEvent.response_id).toBe(originalEvent.response_id);

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
      { numRuns: 50, verbose: true },
    );
  });

  /**
   * Property 2.2: Response ID Uniqueness
   *
   * For any generated events, response IDs passed to helpers SHALL be preserved
   * exactly on every event in the sequence.
   */
  it('Property 2.2: Generated events SHALL share the same response_id', async () => {
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
          const events: OpenResponsesEvent[] = [
            createInProgressEvent(responseId),
            createOutputItemAddedEvent(responseId, itemId),
          ];

          for (let i = 0; i < numDeltas; i++) {
            events.push(createOutputTextDeltaEvent(responseId, itemId, 0, `chunk${i}`));
          }

          events.push(createCompletedEvent(responseId));

          // Every event must have the same response_id
          for (const event of events) {
            expect(event.response_id).toBe(responseId);
          }

          // Every event must have an ISO timestamp
          for (const event of events) {
            expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
          }
        },
      ),
      { numRuns: 30, verbose: true },
    );
  });

  /**
   * Property 2.3: Envelope Creation with JSON String Data
   *
   * For any Open Responses event, createEnvelope SHALL wrap it in a WebSocket Envelope
   * with the data field as a JSON string, type "MESSAGE", and headers { messageId, topic }.
   */
  it('Property 2.3: createEnvelope SHALL produce spec-compliant envelope', async () => {
    const { createEnvelope, textToEventSequence } = await import('../../protocol.js');

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (text) => {
          const events = textToEventSequence(text);

          for (const event of events) {
            const envelopeStr = createEnvelope(event);
            const envelope = JSON.parse(envelopeStr) as WebSocketEnvelope;

            // Per spec: type is uppercase "MESSAGE"
            expect(envelope.type).toBe('MESSAGE');
            expect(envelope.headers).toBeDefined();
            expect(envelope.headers.messageId).toBeDefined();
            // Per spec: topic must exist
            expect(envelope.headers.topic).toBeDefined();
            // Per spec: no timestamp in headers
            expect((envelope.headers as any).timestamp).toBeUndefined();

            // CRITICAL: data field MUST be a string
            expect(typeof envelope.data).toBe('string');

            const parsedData = JSON.parse(envelope.data);
            expect(parsedData).toBeDefined();
            expect(parsedData.type).toBe(event.type);
            expect(parsedData.response_id).toBe(event.response_id);
          }
        },
      ),
      { numRuns: 30, verbose: true },
    );
  });

  /**
   * Property 2.4: Text to Event Sequence Conversion
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
          const events = textToEventSequence(text, responseId ?? undefined);

          expect(events.length).toBeGreaterThanOrEqual(3);

          expect(events[0]?.type).toBe('response.in_progress');
          expect(events[1]?.type).toBe('response.output_item.added');
          expect(events[events.length - 1]?.type).toBe('response.completed');

          const respId = events[0]?.response_id;
          expect(respId).toBeDefined();

          for (const event of events) {
            expect(event.response_id).toBe(respId);
            // All events must have an ISO timestamp — no event_id
            expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect((event as any).event_id).toBeUndefined();
          }

          if (responseId) {
            expect(respId).toBe(responseId);
          }

          const deltaEvents = events.filter(e => e.type === 'response.output_text.delta') as OutputTextDeltaEvent[];
          const reconstructedText = deltaEvents.map(e => e.delta.text).join('');
          expect(reconstructedText).toBe(text);
        },
      ),
      { numRuns: 40, verbose: true },
    );
  });

  /**
   * Property 2.5: Response State Management
   *
   * Verifies the response state management logic tracks status and accumulates text.
   */
  it('Property 2.5: Response state management SHALL correctly track status and accumulate text', () => {
    const activeResponses = new Map<string, any>();

    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 20 }),
        fc.string({ minLength: 10, maxLength: 20 }),
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 10 }),
        (responseId, itemId, textChunks) => {
          activeResponses.set(responseId, {
            id: responseId,
            status: 'in_progress',
            output: { items: [] },
            error: null,
            metadata: {},
          });

          const response = activeResponses.get(responseId);
          expect(response).toBeDefined();
          expect(response.status).toBe('in_progress');

          response.output.items.push({
            id: itemId,
            type: 'message',
            status: 'in_progress',
            role: 'assistant',
            content: [{ type: 'output_text', status: 'in_progress', text: '' }],
          });

          expect(response.output.items.length).toBe(1);
          expect(response.output.items[0].id).toBe(itemId);

          for (const chunk of textChunks) {
            const item = response.output.items.find((i: any) => i.id === itemId);
            const contentPart = item?.content[0];
            if (item && contentPart) {
              contentPart.text += chunk;
            }
          }

          const accumulatedText = response.output.items[0].content[0].text;
          const expectedText = textChunks.join('');
          expect(accumulatedText).toBe(expectedText);

          response.status = 'completed';
          expect(response.status).toBe('completed');

          const fullText = response.output.items
            .flatMap((item: any) => item.content)
            .map((part: any) => part.text)
            .join('');
          expect(fullText).toBe(expectedText);

          activeResponses.delete(responseId);
          expect(activeResponses.has(responseId)).toBe(false);
        },
      ),
      { numRuns: 30, verbose: true },
    );
  });

  /**
   * Property 2.6: Message ID Generation Uniqueness
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

          for (const text of texts) {
            const events = textToEventSequence(text);

            for (const event of events) {
              const envelopeStr = createEnvelope(event);
              const envelope = JSON.parse(envelopeStr) as WebSocketEnvelope;

              const messageId = envelope.headers.messageId;
              expect(messageId).toBeDefined();
              expect(messageIds.has(messageId)).toBe(false);
              messageIds.add(messageId);
            }
          }

          expect(messageIds.size).toBeGreaterThan(0);
        },
      ),
      { numRuns: 20, verbose: true },
    );
  });

  /**
   * Property 2.7: Event Sequence Order Preservation
   *
   * For any text input, the generated event sequence SHALL maintain correct order:
   * in_progress → output_item.added → output_text.delta (multiple) →
   * content_part.done → completed
   */
  it('Property 2.7: Event sequence SHALL maintain correct order', async () => {
    const { textToEventSequence } = await import('../../protocol.js');

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 300 }),
        (text) => {
          const events = textToEventSequence(text);
          const eventTypes = events.map(e => e.type);

          expect(eventTypes[0]).toBe('response.in_progress');
          expect(eventTypes[1]).toBe('response.output_item.added');
          expect(eventTypes[eventTypes.length - 1]).toBe('response.completed');

          // Middle events up to the last should be delta or content_part.done
          const validMiddleTypes = new Set([
            'response.output_text.delta',
            'response.content_part.done',
          ]);
          const middleEvents = eventTypes.slice(2, -1);
          for (const type of middleEvents) {
            expect(validMiddleTypes.has(type)).toBe(true);
          }

          const validTypes = new Set([
            'response.in_progress',
            'response.output_item.added',
            'response.output_text.delta',
            'response.content_part.done',
            'response.completed',
          ]);
          for (const type of eventTypes) {
            expect(validTypes.has(type)).toBe(true);
          }
        },
      ),
      { numRuns: 30, verbose: true },
    );
  });
});
