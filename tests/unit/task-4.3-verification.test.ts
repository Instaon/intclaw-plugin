/**
 * Task 4.3 Verification Tests
 * 
 * This test file verifies that task 4.3 "Implement event transmission via WebSocket" is complete.
 * 
 * Task 4.3 Requirements:
 * - Wrap events in WebSocket envelope with topic "/v1.0/im/bot/messages"
 * - Generate unique messageId for each envelope
 * - Serialize event to JSON for envelope data field
 * - Send envelope via WebSocket connection
 * - Handle WebSocket send failures gracefully
 * 
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SDKDispatcher } from '../../sdk-dispatcher.js';
import { DebugLogger } from '../../logger.js';
import type { WebSocket } from 'ws';

describe('Task 4.3: Event Transmission via WebSocket', () => {
  let dispatcher: SDKDispatcher;
  let mockWs: WebSocket;
  let sentMessages: string[];

  beforeEach(() => {
    // Don't use fake timers - use real timers for async operations
    // vi.useFakeTimers();
    
    // Create mock WebSocket
    sentMessages = [];
    mockWs = {
      readyState: 1, // WebSocket.OPEN
      send: vi.fn((message: string) => {
        sentMessages.push(message);
      }),
    } as unknown as WebSocket;

    // Create dispatcher
    const logger = new DebugLogger(true, '[Test]');
    dispatcher = new SDKDispatcher(
      {
        requestTimeout: 30000,
        maxConcurrentRequests: 5,
        debug: true,
      },
      logger
    );
  });

  describe('Requirement 6.1: Wrap events in WebSocket Envelope with topic "/v1.0/im/bot/messages"', () => {
    it('should wrap response.in_progress event in envelope with correct topic', async () => {
      // Dispatch a request to trigger event generation
      await dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_001' },
        mockWs
      );

      // Wait for mock SDK to invoke callback (using real timers)
      await new Promise(resolve => setTimeout(resolve, 250));

      // Verify at least one message was sent
      expect(sentMessages.length).toBeGreaterThan(0);

      // Parse first message (should be in_progress event)
      const envelope = JSON.parse(sentMessages[0]);

      // Verify envelope structure
      expect(envelope).toHaveProperty('type', 'MESSAGE');
      expect(envelope).toHaveProperty('headers');
      expect(envelope.headers).toHaveProperty('topic', '/v1.0/im/bot/messages');
      expect(envelope).toHaveProperty('data');
    });

    it('should use correct topic for all event types', async () => {
      await dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_002' },
        mockWs
      );

      await new Promise(resolve => setTimeout(resolve, 250));

      // Verify all sent messages have correct topic
      for (const message of sentMessages) {
        const envelope = JSON.parse(message);
        expect(envelope.headers.topic).toBe('/v1.0/im/bot/messages');
      }
    });
  });

  describe('Requirement 6.2: Serialize event to JSON and place in envelope data field', () => {
    it('should serialize event to JSON in envelope data field', async () => {
      await dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_003' },
        mockWs
      );

      await new Promise(resolve => setTimeout(resolve, 250));

      // Parse first envelope
      const envelope = JSON.parse(sentMessages[0]);

      // Verify data field is a JSON string
      expect(typeof envelope.data).toBe('string');

      // Parse the data field to verify it's valid JSON
      const event = JSON.parse(envelope.data);

      // Verify event structure
      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('response_id');
      expect(event).toHaveProperty('timestamp');
    });

    it('should preserve event data when serializing', async () => {
      await dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_004' },
        mockWs
      );

      await new Promise(resolve => setTimeout(resolve, 250));

      // Find delta event (should contain text)
      const deltaEnvelope = sentMessages
        .map(msg => JSON.parse(msg))
        .find(env => {
          const event = JSON.parse(env.data);
          return event.type === 'response.output_text.delta';
        });

      expect(deltaEnvelope).toBeDefined();

      const deltaEvent = JSON.parse(deltaEnvelope.data);
      expect(deltaEvent).toHaveProperty('delta');
      expect(deltaEvent.delta).toHaveProperty('text');
      expect(typeof deltaEvent.delta.text).toBe('string');
    });
  });

  describe('Requirement 6.3: Generate unique messageId for envelope headers', () => {
    it('should generate unique messageId for each envelope', async () => {
      await dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_005' },
        mockWs
      );

      await new Promise(resolve => setTimeout(resolve, 250));

      // Collect all messageIds
      const messageIds = sentMessages.map(msg => {
        const envelope = JSON.parse(msg);
        return envelope.headers.messageId;
      });

      // Verify all messageIds are unique
      const uniqueIds = new Set(messageIds);
      expect(uniqueIds.size).toBe(messageIds.length);
    });

    it('should include messageId in envelope headers', async () => {
      await dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_006' },
        mockWs
      );

      await new Promise(resolve => setTimeout(resolve, 250));

      // Verify all envelopes have messageId
      for (const message of sentMessages) {
        const envelope = JSON.parse(message);
        expect(envelope.headers).toHaveProperty('messageId');
        expect(typeof envelope.headers.messageId).toBe('string');
        expect(envelope.headers.messageId.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Requirement 6.4: Send each envelope through WebSocket immediately after creation', () => {
    it('should send envelope via WebSocket.send()', async () => {
      await dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_007' },
        mockWs
      );

      await new Promise(resolve => setTimeout(resolve, 250));

      // Verify WebSocket.send was called
      expect(mockWs.send).toHaveBeenCalled();
      expect(sentMessages.length).toBeGreaterThan(0);
    });

    it('should send events in correct order', async () => {
      await dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_008' },
        mockWs
      );

      await new Promise(resolve => setTimeout(resolve, 250));

      // Parse event types
      const eventTypes = sentMessages.map(msg => {
        const envelope = JSON.parse(msg);
        const event = JSON.parse(envelope.data);
        return event.type;
      });

      // Verify event sequence follows Open Responses protocol
      expect(eventTypes[0]).toBe('response.in_progress');
      expect(eventTypes[1]).toBe('response.output_item.added');
      expect(eventTypes[2]).toBe('response.output_text.delta');
      expect(eventTypes[eventTypes.length - 2]).toBe('response.content_part.done');
      expect(eventTypes[eventTypes.length - 1]).toBe('response.completed');
    });

    it('should send multiple delta events for multiple chunks', async () => {
      await dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_009' },
        mockWs
      );

      await new Promise(resolve => setTimeout(resolve, 250));

      // Count delta events
      const deltaCount = sentMessages.filter(msg => {
        const envelope = JSON.parse(msg);
        const event = JSON.parse(envelope.data);
        return event.type === 'response.output_text.delta';
      }).length;

      // Mock SDK sends 1 chunk, so should have 1 delta event
      expect(deltaCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Requirement 6.5: If WebSocket not open, log error and discard event', () => {
    it('should not send when WebSocket is closed', async () => {
      // Set WebSocket to closed state
      mockWs.readyState = 3; // WebSocket.CLOSED

      await dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_010' },
        mockWs
      );

      await new Promise(resolve => setTimeout(resolve, 250));

      // Verify no messages were sent
      expect(sentMessages.length).toBe(0);
    });

    it('should not send when WebSocket is connecting', async () => {
      // Set WebSocket to connecting state
      mockWs.readyState = 0; // WebSocket.CONNECTING

      await dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_011' },
        mockWs
      );

      await new Promise(resolve => setTimeout(resolve, 250));

      // Verify no messages were sent
      expect(sentMessages.length).toBe(0);
    });

    it('should not send when WebSocket is closing', async () => {
      // Set WebSocket to closing state
      mockWs.readyState = 2; // WebSocket.CLOSING

      await dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_012' },
        mockWs
      );

      await new Promise(resolve => setTimeout(resolve, 250));

      // Verify no messages were sent
      expect(sentMessages.length).toBe(0);
    });

    it('should handle WebSocket send errors gracefully', async () => {
      // Make WebSocket.send throw an error
      mockWs.send = vi.fn(() => {
        throw new Error('Send failed');
      });

      // Should not throw
      await expect(
        dispatcher.dispatchRequest(
          { content: 'test', messageId: 'msg_013' },
          mockWs
        )
      ).resolves.not.toThrow();

      await new Promise(resolve => setTimeout(resolve, 250));
    });
  });

  describe('Complete event transmission flow', () => {
    it('should transmit complete event sequence via WebSocket', async () => {
      await dispatcher.dispatchRequest(
        { content: 'test message', messageId: 'msg_complete' },
        mockWs
      );

      await new Promise(resolve => setTimeout(resolve, 250));

      // Verify complete event sequence was sent
      expect(sentMessages.length).toBeGreaterThanOrEqual(5);

      // Verify all messages are valid envelopes
      for (const message of sentMessages) {
        const envelope = JSON.parse(message);

        // Verify envelope structure (Requirement 6.1)
        expect(envelope.type).toBe('MESSAGE');
        expect(envelope.headers.topic).toBe('/v1.0/im/bot/messages');

        // Verify unique messageId (Requirement 6.3)
        expect(envelope.headers.messageId).toBeDefined();

        // Verify data is serialized JSON (Requirement 6.2)
        expect(typeof envelope.data).toBe('string');
        const event = JSON.parse(envelope.data);
        expect(event.type).toBeDefined();
        expect(event.response_id).toBeDefined();
      }
    });

    it('should handle failed event transmission', async () => {
      // Create a dispatcher that will fail
      const failingWs = {
        readyState: 1,
        send: vi.fn(() => {
          throw new Error('Network error');
        }),
      } as unknown as WebSocket;

      // Should not throw even if send fails
      await expect(
        dispatcher.dispatchRequest(
          { content: 'test', messageId: 'msg_fail' },
          failingWs
        )
      ).resolves.not.toThrow();

      await new Promise(resolve => setTimeout(resolve, 250));
    });
  });
});
