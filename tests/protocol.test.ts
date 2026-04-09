/**
 * Unit Tests for Protocol Handler
 *
 * Tests the core functionality of the protocol module including
 * message parsing, envelope creation, event generation, and text-to-event conversion.
 *
 * All test fixtures strictly follow open-responses.md:
 *  - Envelope.type  = "MESSAGE"  (uppercase)
 *  - Envelope.headers = { messageId, topic }  (no timestamp, no event_id)
 *  - Envelope.data  = JSON.stringify(event)
 *  - Events carry: type, response_id, timestamp — no extra event_id field
 *
 * Validates: Task 4.1, 4.2, 4.3, 4.4
 */

import { describe, it, expect } from 'vitest';
import {
  parseEnvelope,
  parseRequest,
  createEnvelope,
  createInProgressEvent,
  createOutputItemAddedEvent,
  createOutputTextDeltaEvent,
  createCompletedEvent,
  textToEventSequence,
  TOPIC_BOT_MESSAGES,
  TOPIC_USER_MESSAGES,
} from '../protocol.js';
import type {
  ResponseInProgressEvent,
  OutputItemAddedEvent,
  OutputTextDeltaEvent,
  ResponseCompletedEvent,
} from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeEnvelope(data: object, topic = TOPIC_BOT_MESSAGES, messageId = 'msg_001') {
  return JSON.stringify({
    type: 'MESSAGE',
    headers: { messageId, topic },
    data: JSON.stringify(data),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Protocol Module', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Envelope Parsing — Open Responses events (Task 4.1)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Envelope Parsing — parseEnvelope (Task 4.1)', () => {
    it('should parse valid envelope and extract event', () => {
      const raw = makeEnvelope({
        type: 'response.in_progress',
        response_id: 'resp_456',
        status: 'in_progress',
        timestamp: '2026-03-31T10:00:00Z',
      });

      const event = parseEnvelope(raw);

      expect(event.type).toBe('response.in_progress');
      expect(event.response_id).toBe('resp_456');
    });

    it('should throw error for wrong envelope type (not "MESSAGE")', () => {
      const raw = JSON.stringify({
        type: 'message',           // lowercase — invalid per spec
        headers: { messageId: 'x', topic: TOPIC_BOT_MESSAGES },
        data: JSON.stringify({ type: 'response.in_progress', response_id: 'r' }),
      });

      expect(() => parseEnvelope(raw)).toThrow('"MESSAGE"');
    });

    it('should throw error for missing data field', () => {
      const raw = JSON.stringify({
        type: 'MESSAGE',
        headers: { messageId: 'x', topic: TOPIC_BOT_MESSAGES },
      });

      expect(() => parseEnvelope(raw)).toThrow('data');
    });

    it('should throw error for missing headers field', () => {
      const raw = JSON.stringify({
        type: 'MESSAGE',
        data: JSON.stringify({ type: 'response.in_progress', response_id: 'r' }),
      });

      expect(() => parseEnvelope(raw)).toThrow('headers');
    });

    it('should throw error for missing type field in event', () => {
      const raw = makeEnvelope({ response_id: 'resp_456' });

      expect(() => parseEnvelope(raw)).toThrow('Invalid event: missing or invalid type field');
    });

    it('should throw error for missing response_id in event', () => {
      const raw = makeEnvelope({ type: 'response.in_progress' });

      expect(() => parseEnvelope(raw)).toThrow('Invalid event: missing or invalid response_id field');
    });

    it('should throw descriptive error for invalid JSON', () => {
      expect(() => parseEnvelope('not valid json')).toThrow('Failed to parse envelope');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Request Parsing — inbound user messages (Task 4.1 / §9.1)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Request Parsing — parseRequest (§9.1)', () => {
    it('should parse valid user message envelope', () => {
      const raw = JSON.stringify({
        type: 'MESSAGE',
        headers: { messageId: 'msg_req_001', topic: TOPIC_USER_MESSAGES },
        data: JSON.stringify({ content: '你好呀' }),
      });

      const req = parseRequest(raw);

      expect(req.content).toBe('你好呀');
      expect(req.messageId).toBe('msg_req_001');
      expect(req.topic).toBe(TOPIC_USER_MESSAGES);
    });

    it('should throw error for wrong envelope type', () => {
      const raw = JSON.stringify({
        type: 'message',
        headers: { messageId: 'x', topic: TOPIC_USER_MESSAGES },
        data: JSON.stringify({ content: 'hi' }),
      });

      expect(() => parseRequest(raw)).toThrow('"MESSAGE"');
    });

    it('should throw error for missing content in data', () => {
      const raw = JSON.stringify({
        type: 'MESSAGE',
        headers: { messageId: 'x', topic: TOPIC_USER_MESSAGES },
        data: JSON.stringify({ foo: 'bar' }),
      });

      expect(() => parseRequest(raw)).toThrow('content');
    });

    it('should throw error for missing messageId in headers', () => {
      const raw = JSON.stringify({
        type: 'MESSAGE',
        headers: { topic: TOPIC_USER_MESSAGES },
        data: JSON.stringify({ content: 'hi' }),
      });

      expect(() => parseRequest(raw)).toThrow('messageId');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Envelope Creation (Task 4.2)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Event Serialization — createEnvelope (Task 3.3)', () => {
    it('should serialize event directly without envelope wrapping', () => {
      const event: ResponseInProgressEvent = {
        type: 'response.in_progress',
        response_id: 'resp_456',
        status: 'in_progress',
        timestamp: '2026-03-31T10:00:00Z',
      };

      const serialized = createEnvelope(event);
      const parsed = JSON.parse(serialized);

      // Should be direct event serialization, not wrapped in envelope
      expect(parsed.type).toBe('response.in_progress');
      expect(parsed.response_id).toBe('resp_456');
      expect(parsed.status).toBe('in_progress');
      expect(parsed.timestamp).toBe('2026-03-31T10:00:00Z');
      
      // Should NOT have envelope structure
      expect(parsed.headers).toBeUndefined();
      expect(parsed.data).toBeUndefined();
    });

    it('should preserve all event fields in serialization', () => {
      const event: OutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: 'resp_456',
        item_id: 'item_123',
        content_index: 0,
        delta: { text: 'Hello' },
        timestamp: new Date().toISOString(),
      };

      const serialized = createEnvelope(event);
      const parsed = JSON.parse(serialized);

      // All event fields should be preserved at top level
      expect(parsed.type).toBe('response.output_text.delta');
      expect(parsed.response_id).toBe('resp_456');
      expect(parsed.item_id).toBe('item_123');
      expect(parsed.content_index).toBe(0);
      expect(parsed.delta.text).toBe('Hello');
      
      // Should NOT have envelope structure
      expect(parsed.headers).toBeUndefined();
      expect(parsed.data).toBeUndefined();
    });

    it('should handle different event types correctly', () => {
      const completedEvent: ResponseCompletedEvent = {
        type: 'response.completed',
        response_id: 'resp_789',
        status: 'completed',
        timestamp: new Date().toISOString(),
      };

      const serialized = createEnvelope(completedEvent);
      const parsed = JSON.parse(serialized);

      expect(parsed.type).toBe('response.completed');
      expect(parsed.response_id).toBe('resp_789');
      expect(parsed.status).toBe('completed');
      
      // Should NOT have envelope structure
      expect(parsed.headers).toBeUndefined();
      expect(parsed.data).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Event Creation Helpers (Task 4.3)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Event Creation Helpers (Task 4.3)', () => {
    it('should create response.in_progress event with required fields', () => {
      const event = createInProgressEvent('resp_123');

      expect(event.type).toBe('response.in_progress');
      expect(event.response_id).toBe('resp_123');
      expect(event.status).toBe('in_progress');
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should create response.output_item.added event', () => {
      const event = createOutputItemAddedEvent('resp_123', 'item_456');

      expect(event.type).toBe('response.output_item.added');
      expect(event.response_id).toBe('resp_123');
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(event.item.id).toBe('item_456');
      expect(event.item.type).toBe('message');
      expect(event.item.role).toBe('assistant');
      expect(event.item.status).toBe('in_progress');
      expect(event.item.content).toHaveLength(1);
      expect(event.item.content[0]?.type).toBe('output_text');
      expect(event.item.content[0]?.text).toBe('');
    });

    it('should create response.output_text.delta event', () => {
      const event = createOutputTextDeltaEvent('resp_123', 'item_456', 0, 'Hello');

      expect(event.type).toBe('response.output_text.delta');
      expect(event.response_id).toBe('resp_123');
      expect(event.item_id).toBe('item_456');
      expect(event.content_index).toBe(0);
      expect(event.delta.text).toBe('Hello');
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should create response.completed event', () => {
      const event = createCompletedEvent('resp_123');

      expect(event.type).toBe('response.completed');
      expect(event.response_id).toBe('resp_123');
      expect(event.status).toBe('completed');
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Text to Event Sequence (Task 4.4)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Text to Event Sequence (Task 4.4)', () => {
    it('should convert short text to event sequence', () => {
      const text = 'Hello, world!';
      const events = textToEventSequence(text);

      // Should have: in_progress, item_added, delta(s), content_part.done, completed
      expect(events.length).toBeGreaterThanOrEqual(4);

      expect(events[0]?.type).toBe('response.in_progress');
      expect(events[1]?.type).toBe('response.output_item.added');
      expect(events[events.length - 1]?.type).toBe('response.completed');

      // All events share the same response_id
      const responseId = events[0]?.response_id;
      for (const event of events) {
        expect(event.response_id).toBe(responseId);
      }
    });

    it('should split long text into multiple delta events', () => {
      const longText = 'a'.repeat(200);
      const events = textToEventSequence(longText);

      const deltaEvents = events.filter(e => e.type === 'response.output_text.delta');

      // With TEXT_CHUNK_SIZE of 50, 200 chars → 4 deltas
      expect(deltaEvents.length).toBe(4);

      for (const event of deltaEvents) {
        expect((event as OutputTextDeltaEvent).delta.text.length).toBeLessThanOrEqual(50);
      }
    });

    it('should use provided response ID', () => {
      const events = textToEventSequence('Test', 'custom_resp_123');

      for (const event of events) {
        expect(event.response_id).toBe('custom_resp_123');
      }
    });

    it('should generate response ID matching resp_ pattern when not provided', () => {
      const events = textToEventSequence('Test');
      const responseId = events[0]?.response_id;

      expect(responseId).toBeDefined();
      expect(responseId).toMatch(/^resp_/);
    });

    it('should handle empty text', () => {
      const events = textToEventSequence('');

      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events[0]?.type).toBe('response.in_progress');
      expect(events[1]?.type).toBe('response.output_item.added');
      expect(events[events.length - 1]?.type).toBe('response.completed');
    });

    it('should concatenate all delta texts to original text', () => {
      const originalText = 'The quick brown fox jumps over the lazy dog';
      const events = textToEventSequence(originalText);

      const deltaEvents = events.filter(e => e.type === 'response.output_text.delta') as OutputTextDeltaEvent[];
      const reconstructedText = deltaEvents.map(e => e.delta.text).join('');

      expect(reconstructedText).toBe(originalText);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Round-trip Property (Validates Requirement 11.7)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Round-trip Property', () => {
    it('should preserve event through createEnvelope → parseEnvelope cycle', () => {
      const originalEvent: ResponseInProgressEvent = {
        type: 'response.in_progress',
        response_id: 'resp_456',
        status: 'in_progress',
        timestamp: '2026-03-31T10:00:00Z',
      };

      const envelopeStr = createEnvelope(originalEvent);
      const parsedEvent = parseEnvelope(envelopeStr);

      expect(parsedEvent.type).toBe(originalEvent.type);
      expect(parsedEvent.response_id).toBe(originalEvent.response_id);
    });

    it('should preserve complex event through round-trip', () => {
      const originalEvent: OutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: 'resp_456',
        item_id: 'item_123',
        content_index: 2,
        delta: { text: 'Hello, world!' },
        timestamp: '2026-03-31T10:00:02Z',
      };

      const envelopeStr = createEnvelope(originalEvent);
      const parsedEvent = parseEnvelope(envelopeStr) as OutputTextDeltaEvent;

      expect(parsedEvent.type).toBe(originalEvent.type);
      expect(parsedEvent.response_id).toBe(originalEvent.response_id);
      expect(parsedEvent.item_id).toBe(originalEvent.item_id);
      expect(parsedEvent.content_index).toBe(originalEvent.content_index);
      expect(parsedEvent.delta.text).toBe(originalEvent.delta.text);
    });
  });
});
