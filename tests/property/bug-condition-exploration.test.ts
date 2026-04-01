/**
 * Bug Condition Exploration Property Test
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 *
 * This test explores and confirms the correct request-response flow after the fix.
 * The plugin acts as a RESPONDER: it receives user messages (topic: /v1.0/im/user/messages)
 * and responds with Open Responses event sequences (topic: /v1.0/im/bot/messages).
 *
 * Per open-responses.md §9:
 *   Client → Plugin:  { type: "MESSAGE", headers: { messageId, topic: "/v1.0/im/user/messages" },
 *                       data: '{"content":"..."}' }
 *   Plugin → Client:  5 frames following the event sequence
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { WebSocketEnvelope, OpenResponsesEvent } from '../../types.js';
import {
  parseRequest,
  generateResponseSequence,
  createEnvelope,
  TOPIC_USER_MESSAGES,
  TOPIC_BOT_MESSAGES,
} from '../../protocol.js';

describe('Request-Response Protocol — Correct Implementation', () => {
  /**
   * Property 1: Plugin correctly handles the request-response cycle
   *
   * For any inbound user message envelope (topic: user/messages),
   * the plugin SHALL:
   * 1. Parse the request from the envelope
   * 2. Generate an Open Responses event sequence as response
   * 3. Wrap each event in an envelope targeting bot/messages topic
   * 4. Use JSON string for data field
   */
  it('Property 1: Plugin SHALL parse user messages and respond with Open Responses events', () => {
    // Generator for valid user message envelopes (open-responses.md §9.1)
    const userMessageArb = fc.record({
      content: fc.string({ minLength: 1, maxLength: 200 }),
      messageId: fc.string({ minLength: 5, maxLength: 20 }),
    }).map(({ content, messageId }) =>
      JSON.stringify({
        type: 'MESSAGE',
        headers: { messageId, topic: TOPIC_USER_MESSAGES },
        data: JSON.stringify({ content }),
      })
    );

    fc.assert(
      fc.property(userMessageArb, (rawRequest) => {
        // STEP 1: Parse the inbound user message
        const parsedRequest = parseRequest(rawRequest);

        expect(parsedRequest).toBeDefined();
        expect(typeof parsedRequest.content).toBe('string');
        expect(parsedRequest.content.length).toBeGreaterThan(0);
        expect(parsedRequest.messageId).toBeDefined();
        expect(parsedRequest.topic).toBe(TOPIC_USER_MESSAGES);

        // STEP 2: Generate Open Responses event sequence
        const responseText = `Echo: ${parsedRequest.content}`;
        const responseEvents = generateResponseSequence(parsedRequest, responseText);

        expect(responseEvents).toBeDefined();
        expect(Array.isArray(responseEvents)).toBe(true);
        expect(responseEvents.length).toBeGreaterThan(0);

        // Sequence order: in_progress → output_item.added → delta(s) → completed
        expect(responseEvents[0]?.type).toBe('response.in_progress');
        expect(responseEvents[responseEvents.length - 1]?.type).toBe('response.completed');

        // All events share the same response_id
        const responseId = responseEvents[0]?.response_id;
        for (const event of responseEvents) {
          expect(event.response_id).toBe(responseId);
        }

        // STEP 3: Wrap each event in an envelope targeting bot/messages topic
        for (const event of responseEvents) {
          const envelopeStr = createEnvelope(event);           // default: TOPIC_BOT_MESSAGES
          const envelope = JSON.parse(envelopeStr) as WebSocketEnvelope;

          // Per spec: type = "MESSAGE" (uppercase)
          expect(envelope.type).toBe('MESSAGE');
          expect(envelope.headers).toBeDefined();
          expect(envelope.headers.messageId).toBeDefined();
          // Bot responses go to bot/messages topic
          expect(envelope.headers.topic).toBe(TOPIC_BOT_MESSAGES);
          // Per spec: no timestamp in headers
          expect((envelope.headers as any).timestamp).toBeUndefined();

          // CRITICAL: data field MUST be a JSON string
          expect(typeof envelope.data).toBe('string');

          const parsedData = JSON.parse(envelope.data);
          expect(parsedData).toBeDefined();
          expect(parsedData.type).toBeDefined();
          expect(parsedData.response_id).toBeDefined();
        }
      }),
      { numRuns: 20, verbose: true },
    );
  });

  /**
   * Supplementary: parseEnvelope correctly rejects non-MESSAGE type envelopes
   *
   * Per spec, the envelope type must be exactly "MESSAGE" (uppercase).
   * Any deviation shall cause a parse error.
   */
  it('parseEnvelope SHALL reject envelopes with incorrect type', async () => {
    const { parseEnvelope } = await import('../../protocol.js');

    // Lowercase "message" — invalid per spec
    const invalidEnvelope = JSON.stringify({
      type: 'message',
      headers: { messageId: 'msg_001', topic: TOPIC_BOT_MESSAGES },
      data: JSON.stringify({
        type: 'response.in_progress',
        response_id: 'resp_123',
        status: 'in_progress',
        timestamp: new Date().toISOString(),
      }),
    });

    expect(() => parseEnvelope(invalidEnvelope)).toThrow('"MESSAGE"');
  });

  /**
   * Supplementary: Verify event sequences have no spurious fields
   *
   * Events MUST NOT contain event_id, request_id, userId, or any non-spec field.
   */
  it('Generated events SHALL NOT contain non-spec fields (event_id, etc.)', async () => {
    const { textToEventSequence } = await import('../../protocol.js');

    const events = textToEventSequence('Test message');

    for (const event of events) {
      expect((event as any).event_id).toBeUndefined();
      expect((event as any).request_id).toBeUndefined();
      expect((event as any).userId).toBeUndefined();
      // Every event must have the three base fields
      expect(event.type).toBeDefined();
      expect(event.response_id).toBeDefined();
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});
