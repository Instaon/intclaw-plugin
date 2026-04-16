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
  extractContentFromInput,
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
    it('should parse standard request with single input_text', () => {
      const raw = JSON.stringify({
        model: 'test-model',
        stream: true,
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: '你好呀' }],
          },
        ],
        metadata: { session_id: 'sess_001', message_id: 'msg_req_001' },
      });

      const req = parseRequest(raw);

      expect(req.content).toBe('> 你好呀');
      expect(req.messageId).toBe('msg_req_001');
      expect(req.sessionId).toBe('sess_001');
      expect(req.stream).toBe(true);
      expect(req.model).toBe('test-model');
      expect(req.topic).toBe(TOPIC_USER_MESSAGES);
    });

    it('should parse request with input_file + input_text and concatenate with Markdown', () => {
      const raw = JSON.stringify({
        model: 'test-model',
        stream: false,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_file', file_url: 'https://example.com/demo.pdf', filename: 'demo.pdf' },
              { type: 'input_text', text: '总结这个文件' },
            ],
          },
        ],
        metadata: { session_id: 'sess_002' },
      });

      const req = parseRequest(raw);

      expect(req.content).toBe('[demo.pdf](https://example.com/demo.pdf)\n\n> 总结这个文件');
      expect(req.stream).toBe(false);
    });

    it('should parse request with input_image using Markdown image syntax', () => {
      const raw = JSON.stringify({
        stream: true,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_image', image_url: 'https://example.com/photo.jpg', filename: 'photo.jpg' },
              { type: 'input_text', text: '这张图里有什么?' },
            ],
          },
        ],
        metadata: { session_id: 'sess_003' },
      });

      const req = parseRequest(raw);

      expect(req.content).toBe('![photo.jpg](https://example.com/photo.jpg)\n\n> 这张图里有什么?');
    });

    it('should concatenate multiple input messages with horizontal rule separator', () => {
      const raw = JSON.stringify({
        stream: true,
        input: [
          { role: 'user', content: [{ type: 'input_text', text: '第一条消息' }] },
          { role: 'user', content: [{ type: 'input_text', text: '第二条消息' }] },
        ],
        metadata: { session_id: 'sess_004' },
      });

      const req = parseRequest(raw);

      expect(req.content).toBe('> 第一条消息\n\n---\n\n> 第二条消息');
    });

    it('should use file_id as fallback URL when file_url is absent', () => {
      const raw = JSON.stringify({
        stream: true,
        input: [
          {
            role: 'user',
            content: [{ type: 'input_file', file_id: 'fid_abc123', filename: 'report.pdf' }],
          },
        ],
        metadata: { session_id: 'sess_005' },
      });

      const req = parseRequest(raw);

      expect(req.content).toBe('[report.pdf](file:fid_abc123)');
    });

    it('should skip unknown content types gracefully', () => {
      const raw = JSON.stringify({
        stream: true,
        input: [
          {
            role: 'user',
            content: [
              { type: 'unknown_type', data: 'ignored' },
              { type: 'input_text', text: '这段文本应该被保留' },
            ],
          },
        ],
        metadata: { session_id: 'sess_006' },
      });

      const req = parseRequest(raw);

      expect(req.content).toBe('> 这段文本应该被保留');
    });

    it('should generate sessionId when metadata.session_id is absent', () => {
      const raw = JSON.stringify({
        stream: true,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
      });

      const req = parseRequest(raw);

      expect(req.sessionId).toMatch(/^msg_/);
    });

    it('should default stream to true when field is absent', () => {
      const raw = JSON.stringify({
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
        metadata: { session_id: 'sess_007' },
      });

      const req = parseRequest(raw);

      expect(req.stream).toBe(true);
    });

    it('should throw error for missing input array', () => {
      const raw = JSON.stringify({ model: 'test', metadata: { session_id: 'x' } });

      expect(() => parseRequest(raw)).toThrow('missing or empty input array');
    });

    it('should throw error when all content parts yield no extractable text', () => {
      const raw = JSON.stringify({
        stream: true,
        input: [{ role: 'user', content: [{ type: 'unknown_type' }] }],
        metadata: { session_id: 'sess_008' },
      });

      expect(() => parseRequest(raw)).toThrow('no extractable content');
    });

    it('should throw descriptive error for invalid JSON', () => {
      expect(() => parseRequest('not valid json')).toThrow('Failed to parse standard request');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // extractContentFromInput unit tests
  // ───────────────────────────────────────────────────────────────────────────
  describe('extractContentFromInput', () => {
    it('renders input_text as blockquote', () => {
      const result = extractContentFromInput([
        { content: [{ type: 'input_text', text: 'hello' }] },
      ]);
      expect(result).toBe('> hello');
    });

    it('renders input_file as Markdown link', () => {
      const result = extractContentFromInput([
        { content: [{ type: 'input_file', filename: 'a.pdf', file_url: 'https://x.com/a.pdf' }] },
      ]);
      expect(result).toBe('[a.pdf](https://x.com/a.pdf)');
    });

    it('renders input_image as Markdown image', () => {
      const result = extractContentFromInput([
        { content: [{ type: 'input_image', filename: 'pic.png', image_url: 'https://x.com/pic.png' }] },
      ]);
      expect(result).toBe('![pic.png](https://x.com/pic.png)');
    });

    it('concatenates file + text with blank line separator', () => {
      const result = extractContentFromInput([
        {
          content: [
            { type: 'input_file', filename: 'demo.pdf', file_url: 'https://example.com/demo.pdf' },
            { type: 'input_text', text: '总结这个文件' },
          ],
        },
      ]);
      expect(result).toBe('[demo.pdf](https://example.com/demo.pdf)\n\n> 总结这个文件');
    });

    it('joins multiple input messages with horizontal rule', () => {
      const result = extractContentFromInput([
        { content: [{ type: 'input_text', text: 'A' }] },
        { content: [{ type: 'input_text', text: 'B' }] },
      ]);
      expect(result).toBe('> A\n\n---\n\n> B');
    });

    it('uses default filename when filename is absent', () => {
      const result = extractContentFromInput([
        { content: [{ type: 'input_file', file_url: 'https://x.com/doc' }] },
      ]);
      expect(result).toBe('[file](https://x.com/doc)');
    });

    it('falls back to file_id when file_url is absent', () => {
      const result = extractContentFromInput([
        { content: [{ type: 'input_file', filename: 'f.pdf', file_id: 'fid_xyz' }] },
      ]);
      expect(result).toBe('[f.pdf](file:fid_xyz)');
    });

    it('skips unknown types silently', () => {
      const result = extractContentFromInput([
        { content: [{ type: 'magical_type' }, { type: 'input_text', text: 'kept' }] },
      ]);
      expect(result).toBe('> kept');
    });

    it('skips blank text in input_text', () => {
      const result = extractContentFromInput([
        {
          content: [
            { type: 'input_text', text: '   ' },
            { type: 'input_text', text: 'non-empty' },
          ],
        },
      ]);
      expect(result).toBe('> non-empty');
    });

    it('returns empty string for input with no renderable parts', () => {
      const result = extractContentFromInput([
        { content: [{ type: 'unknown' }] },
      ]);
      expect(result).toBe('');
    });

    it('skips items without a content array', () => {
      const result = extractContentFromInput([
        { role: 'system' }, // no content array
        { content: [{ type: 'input_text', text: 'valid' }] },
      ]);
      expect(result).toBe('> valid');
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
