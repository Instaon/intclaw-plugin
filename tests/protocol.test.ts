/**
 * Unit Tests for Protocol Handler
 * 
 * Tests the core functionality of the protocol module including
 * message parsing, envelope creation, event generation, and text-to-event conversion.
 * 
 * Validates: Task 4.1, 4.2, 4.3, 4.4
 */

import { describe, it, expect } from 'vitest';
import {
  parseEnvelope,
  createEnvelope,
  createInProgressEvent,
  createOutputItemAddedEvent,
  createOutputTextDeltaEvent,
  createCompletedEvent,
  textToEventSequence,
} from '../protocol.js';
import type {
  ResponseInProgressEvent,
  OutputItemAddedEvent,
  OutputTextDeltaEvent,
  ResponseCompletedEvent,
} from '../types.js';

describe('Protocol Module', () => {
  describe('Envelope Parsing (Task 4.1)', () => {
    it('should parse valid WebSocket Envelope and extract event', () => {
      const raw = JSON.stringify({
        type: 'message',
        headers: { messageId: 'msg_001', timestamp: Date.now() },
        data: JSON.stringify({
          type: 'response.in_progress',
          event_id: 'evt_123',
          response_id: 'resp_456',
        }),
      });

      const event = parseEnvelope(raw);

      expect(event.type).toBe('response.in_progress');
      expect(event.event_id).toBe('evt_123');
      expect(event.response_id).toBe('resp_456');
    });

    it('should throw error for missing type field in envelope', () => {
      const raw = JSON.stringify({
        headers: {},
        data: '{}',
      });

      expect(() => parseEnvelope(raw)).toThrow('Invalid envelope: missing or invalid type field');
    });

    it('should throw error for missing data field in envelope', () => {
      const raw = JSON.stringify({
        type: 'message',
        headers: {},
      });

      expect(() => parseEnvelope(raw)).toThrow('Invalid envelope: missing or invalid data field');
    });

    it('should throw error for missing headers field in envelope', () => {
      const raw = JSON.stringify({
        type: 'message',
        data: '{}',
      });

      expect(() => parseEnvelope(raw)).toThrow('Invalid envelope: missing or invalid headers field');
    });

    it('should throw error for missing type field in event', () => {
      const raw = JSON.stringify({
        type: 'message',
        headers: {},
        data: JSON.stringify({
          event_id: 'evt_123',
          response_id: 'resp_456',
        }),
      });

      expect(() => parseEnvelope(raw)).toThrow('Invalid event: missing or invalid type field');
    });

    it('should throw error for missing event_id field in event', () => {
      const raw = JSON.stringify({
        type: 'message',
        headers: {},
        data: JSON.stringify({
          type: 'response.in_progress',
          response_id: 'resp_456',
        }),
      });

      expect(() => parseEnvelope(raw)).toThrow('Invalid event: missing or invalid event_id field');
    });

    it('should throw descriptive error for invalid JSON', () => {
      const raw = 'not valid json';

      expect(() => parseEnvelope(raw)).toThrow('Failed to parse envelope');
    });
  });

  describe('Envelope Creation (Task 4.2)', () => {
    it('should create WebSocket Envelope from event', () => {
      const event: ResponseInProgressEvent = {
        type: 'response.in_progress',
        event_id: 'evt_123',
        response_id: 'resp_456',
      };

      const envelopeStr = createEnvelope(event);
      const envelope = JSON.parse(envelopeStr);

      expect(envelope.type).toBe('message');
      expect(envelope.headers).toBeDefined();
      expect(envelope.headers.messageId).toMatch(/^msg_\d+_[a-z0-9]+$/);
      expect(envelope.headers.timestamp).toBeTypeOf('number');
      expect(envelope.data).toBeDefined();

      const parsedEvent = JSON.parse(envelope.data);
      expect(parsedEvent.type).toBe('response.in_progress');
      expect(parsedEvent.event_id).toBe('evt_123');
      expect(parsedEvent.response_id).toBe('resp_456');
    });

    it('should generate unique message IDs', () => {
      const event: ResponseInProgressEvent = {
        type: 'response.in_progress',
        event_id: 'evt_123',
        response_id: 'resp_456',
      };

      const envelope1 = JSON.parse(createEnvelope(event));
      const envelope2 = JSON.parse(createEnvelope(event));

      expect(envelope1.headers.messageId).not.toBe(envelope2.headers.messageId);
    });

    it('should preserve all event fields in envelope data', () => {
      const event: OutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        event_id: 'evt_789',
        response_id: 'resp_456',
        item_id: 'item_123',
        content_index: 0,
        delta: { text: 'Hello' },
      };

      const envelopeStr = createEnvelope(event);
      const envelope = JSON.parse(envelopeStr);
      const parsedEvent = JSON.parse(envelope.data);

      expect(parsedEvent.type).toBe('response.output_text.delta');
      expect(parsedEvent.event_id).toBe('evt_789');
      expect(parsedEvent.response_id).toBe('resp_456');
      expect(parsedEvent.item_id).toBe('item_123');
      expect(parsedEvent.content_index).toBe(0);
      expect(parsedEvent.delta.text).toBe('Hello');
    });
  });

  describe('Event Creation Helpers (Task 4.3)', () => {
    it('should create response.in_progress event', () => {
      const event = createInProgressEvent('resp_123');

      expect(event.type).toBe('response.in_progress');
      expect(event.response_id).toBe('resp_123');
      expect(event.event_id).toMatch(/^evt_\d+_[a-z0-9]+$/);
    });

    it('should create response.output_item.added event', () => {
      const event = createOutputItemAddedEvent('resp_123', 'item_456');

      expect(event.type).toBe('response.output_item.added');
      expect(event.response_id).toBe('resp_123');
      expect(event.event_id).toMatch(/^evt_\d+_[a-z0-9]+$/);
      expect(event.item.id).toBe('item_456');
      expect(event.item.type).toBe('message');
      expect(event.item.content).toHaveLength(1);
      expect(event.item.content[0]?.type).toBe('text');
      expect(event.item.content[0]?.text).toBe('');
    });

    it('should create response.output_text.delta event', () => {
      const event = createOutputTextDeltaEvent('resp_123', 'item_456', 0, 'Hello');

      expect(event.type).toBe('response.output_text.delta');
      expect(event.response_id).toBe('resp_123');
      expect(event.item_id).toBe('item_456');
      expect(event.content_index).toBe(0);
      expect(event.delta.text).toBe('Hello');
      expect(event.event_id).toMatch(/^evt_\d+_[a-z0-9]+$/);
    });

    it('should create response.completed event', () => {
      const event = createCompletedEvent('resp_123');

      expect(event.type).toBe('response.completed');
      expect(event.response_id).toBe('resp_123');
      expect(event.event_id).toMatch(/^evt_\d+_[a-z0-9]+$/);
    });

    it('should generate unique event IDs', () => {
      const event1 = createInProgressEvent('resp_123');
      const event2 = createInProgressEvent('resp_123');

      expect(event1.event_id).not.toBe(event2.event_id);
    });
  });

  describe('Text to Event Sequence (Task 4.4)', () => {
    it('should convert short text to event sequence', () => {
      const text = 'Hello, world!';
      const events = textToEventSequence(text);

      // Should have: in_progress, item_added, delta(s), completed
      expect(events.length).toBeGreaterThanOrEqual(4);

      // First event should be in_progress
      expect(events[0]?.type).toBe('response.in_progress');

      // Second event should be output_item.added
      expect(events[1]?.type).toBe('response.output_item.added');

      // Last event should be completed
      expect(events[events.length - 1]?.type).toBe('response.completed');

      // All events should have the same response_id
      const responseId = events[0]?.response_id;
      for (const event of events) {
        expect(event.response_id).toBe(responseId);
      }
    });

    it('should split long text into multiple delta events', () => {
      const longText = 'a'.repeat(200); // 200 characters
      const events = textToEventSequence(longText);

      // Count delta events
      const deltaEvents = events.filter(e => e.type === 'response.output_text.delta');

      // With TEXT_CHUNK_SIZE of 50, should have 4 delta events (200 / 50 = 4)
      expect(deltaEvents.length).toBe(4);

      // Verify each delta has correct structure
      for (const event of deltaEvents) {
        expect(event.type).toBe('response.output_text.delta');
        expect((event as OutputTextDeltaEvent).delta.text.length).toBeLessThanOrEqual(50);
      }
    });

    it('should use provided response ID', () => {
      const text = 'Test';
      const customResponseId = 'custom_resp_123';
      const events = textToEventSequence(text, customResponseId);

      for (const event of events) {
        expect(event.response_id).toBe(customResponseId);
      }
    });

    it('should generate response ID if not provided', () => {
      const text = 'Test';
      const events = textToEventSequence(text);

      const responseId = events[0]?.response_id;
      expect(responseId).toBeDefined();
      expect(responseId).toMatch(/^resp_\d+$/);
    });

    it('should handle empty text', () => {
      const text = '';
      const events = textToEventSequence(text);

      // Should still have the basic structure
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

  describe('Round-trip Property (Validates Requirement 11.7)', () => {
    it('should preserve event through createEnvelope -> parseEnvelope cycle', () => {
      const originalEvent: ResponseInProgressEvent = {
        type: 'response.in_progress',
        event_id: 'evt_123',
        response_id: 'resp_456',
      };

      const envelopeStr = createEnvelope(originalEvent);
      const parsedEvent = parseEnvelope(envelopeStr);

      expect(parsedEvent.type).toBe(originalEvent.type);
      expect(parsedEvent.event_id).toBe(originalEvent.event_id);
      expect(parsedEvent.response_id).toBe(originalEvent.response_id);
    });

    it('should preserve complex event through round-trip', () => {
      const originalEvent: OutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        event_id: 'evt_789',
        response_id: 'resp_456',
        item_id: 'item_123',
        content_index: 2,
        delta: { text: 'Hello, world!' },
      };

      const envelopeStr = createEnvelope(originalEvent);
      const parsedEvent = parseEnvelope(envelopeStr) as OutputTextDeltaEvent;

      expect(parsedEvent.type).toBe(originalEvent.type);
      expect(parsedEvent.event_id).toBe(originalEvent.event_id);
      expect(parsedEvent.response_id).toBe(originalEvent.response_id);
      expect(parsedEvent.item_id).toBe(originalEvent.item_id);
      expect(parsedEvent.content_index).toBe(originalEvent.content_index);
      expect(parsedEvent.delta.text).toBe(originalEvent.delta.text);
    });
  });
});
