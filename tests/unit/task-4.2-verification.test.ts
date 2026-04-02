/**
 * Task 4.2 Verification Tests
 * 
 * These tests verify that event generation is properly integrated into callback handlers:
 * - handleChunk calls event generators
 * - handleCompletion calls event generators
 * - handleError calls event generators
 * - Events are generated in correct order
 * 
 * Validates: Requirements 5.5, 12.3
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SDKDispatcher } from '../../sdk-dispatcher.js';
import { DebugLogger } from '../../logger.js';
import type { WebSocket } from 'ws';

describe('Task 4.2: Event Generation Integration', () => {
  let mockWs: WebSocket;
  let mockLogger: DebugLogger;
  let dispatcher: SDKDispatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    
    // Create mock WebSocket
    mockWs = {
      readyState: 1, // OPEN
      send: vi.fn(),
    } as any;

    // Create mock logger
    mockLogger = new DebugLogger(true, '[Test]');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('handleChunk event generation', () => {
    it('should call generateInProgressEvent on first chunk', async () => {
      // Create dispatcher
      const config = {
        requestTimeout: 30000,
        maxConcurrentRequests: 5,
        debug: true,
      };
      dispatcher = new SDKDispatcher(config, mockLogger);

      // Dispatch a request
      const dispatchPromise = dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_001' },
        mockWs
      );

      // Advance timers to trigger the mock SDK callback (100ms for first chunk)
      await vi.advanceTimersByTimeAsync(100);

      // Verify in_progress event was sent (first event)
      expect(mockWs.send).toHaveBeenCalled();
      const firstCall = (mockWs.send as any).mock.calls[0][0];
      const firstEnvelope = JSON.parse(firstCall);
      const firstEvent = JSON.parse(firstEnvelope.data);
      
      expect(firstEvent.type).toBe('response.in_progress');
    });

    it('should call generateItemAddedEvent on first chunk', async () => {
      // Create dispatcher
      const config = {
        requestTimeout: 30000,
        maxConcurrentRequests: 5,
        debug: true,
      };
      dispatcher = new SDKDispatcher(config, mockLogger);

      // Dispatch a request
      const dispatchPromise = dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_002' },
        mockWs
      );

      // Advance timers to trigger the mock SDK callback (100ms for first chunk)
      await vi.advanceTimersByTimeAsync(100);

      // Verify item_added event was sent (second event)
      expect(mockWs.send).toHaveBeenCalledTimes(3); // in_progress, item_added, delta
      const secondCall = (mockWs.send as any).mock.calls[1][0];
      const secondEnvelope = JSON.parse(secondCall);
      const secondEvent = JSON.parse(secondEnvelope.data);
      
      expect(secondEvent.type).toBe('response.output_item.added');
    });

    it('should call generateDeltaEvent for each chunk', async () => {
      // Create dispatcher
      const config = {
        requestTimeout: 30000,
        maxConcurrentRequests: 5,
        debug: true,
      };
      dispatcher = new SDKDispatcher(config, mockLogger);

      // Dispatch a request
      const dispatchPromise = dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_003' },
        mockWs
      );

      // Advance timers to trigger the mock SDK callback (100ms for first chunk)
      await vi.advanceTimersByTimeAsync(100);

      // Verify delta event was sent (third event)
      expect(mockWs.send).toHaveBeenCalledTimes(3);
      const thirdCall = (mockWs.send as any).mock.calls[2][0];
      const thirdEnvelope = JSON.parse(thirdCall);
      const thirdEvent = JSON.parse(thirdEnvelope.data);
      
      expect(thirdEvent.type).toBe('response.output_text.delta');
    });

    it('should generate events in correct order: in_progress → item_added → delta', async () => {
      // Create dispatcher
      const config = {
        requestTimeout: 30000,
        maxConcurrentRequests: 5,
        debug: true,
      };
      dispatcher = new SDKDispatcher(config, mockLogger);

      // Dispatch a request
      const dispatchPromise = dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_004' },
        mockWs
      );

      // Advance timers to trigger the mock SDK callback (100ms for first chunk)
      await vi.advanceTimersByTimeAsync(100);

      // Verify event order
      expect(mockWs.send).toHaveBeenCalledTimes(3);
      
      const calls = (mockWs.send as any).mock.calls;
      const events = calls.map((call: any) => {
        const envelope = JSON.parse(call[0]);
        const event = JSON.parse(envelope.data);
        return event.type;
      });
      
      expect(events).toEqual([
        'response.in_progress',
        'response.output_item.added',
        'response.output_text.delta',
      ]);
    });
  });

  describe('handleCompletion event generation', () => {
    it('should call generateContentPartDoneEvent on completion', async () => {
      // Create dispatcher
      const config = {
        requestTimeout: 30000,
        maxConcurrentRequests: 5,
        debug: true,
      };
      dispatcher = new SDKDispatcher(config, mockLogger);

      // Dispatch a request that completes
      const dispatchPromise = dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_005' },
        mockWs
      );

      // Wait for completion (100ms for first chunk + 100ms for completion)
      await vi.advanceTimersByTimeAsync(250);

      // Find content_part.done event
      const calls = (mockWs.send as any).mock.calls;
      const contentPartDoneCall = calls.find((call: any) => {
        const envelope = JSON.parse(call[0]);
        const event = JSON.parse(envelope.data);
        return event.type === 'response.content_part.done';
      });
      
      expect(contentPartDoneCall).toBeDefined();
    });

    it('should call generateCompletedEvent on completion', async () => {
      // Create dispatcher
      const config = {
        requestTimeout: 30000,
        maxConcurrentRequests: 5,
        debug: true,
      };
      dispatcher = new SDKDispatcher(config, mockLogger);

      // Dispatch a request that completes
      const dispatchPromise = dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_006' },
        mockWs
      );

      // Wait for completion
      await vi.advanceTimersByTimeAsync(250);

      // Find completed event
      const calls = (mockWs.send as any).mock.calls;
      const completedCall = calls.find((call: any) => {
        const envelope = JSON.parse(call[0]);
        const event = JSON.parse(envelope.data);
        return event.type === 'response.completed';
      });
      
      expect(completedCall).toBeDefined();
    });

    it('should generate completion events in correct order: content_part.done → completed', async () => {
      // Create dispatcher
      const config = {
        requestTimeout: 30000,
        maxConcurrentRequests: 5,
        debug: true,
      };
      dispatcher = new SDKDispatcher(config, mockLogger);

      // Dispatch a request that completes
      const dispatchPromise = dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_007' },
        mockWs
      );

      // Wait for completion
      await vi.advanceTimersByTimeAsync(250);

      // Get all event types
      const calls = (mockWs.send as any).mock.calls;
      const events = calls.map((call: any) => {
        const envelope = JSON.parse(call[0]);
        const event = JSON.parse(envelope.data);
        return event.type;
      });
      
      // Find indices of completion events
      const contentPartDoneIndex = events.indexOf('response.content_part.done');
      const completedIndex = events.indexOf('response.completed');
      
      expect(contentPartDoneIndex).toBeGreaterThan(-1);
      expect(completedIndex).toBeGreaterThan(-1);
      expect(contentPartDoneIndex).toBeLessThan(completedIndex);
    });
  });

  describe('handleError event generation', () => {
    it('should call generateFailedEvent on error', async () => {
      // Create a dispatcher that will fail
      const config = {
        requestTimeout: 30000,
        maxConcurrentRequests: 5,
        debug: true,
      };
      const failingDispatcher = new SDKDispatcher(config, mockLogger);

      // Mock SDK dispatch to throw error
      vi.spyOn(failingDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('SDK error')
      );

      // Dispatch a request that will fail
      const dispatchPromise = failingDispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_008' },
        mockWs
      );

      // Wait for error handling
      await vi.advanceTimersByTimeAsync(150);

      // Find failed event
      const calls = (mockWs.send as any).mock.calls;
      const failedCall = calls.find((call: any) => {
        const envelope = JSON.parse(call[0]);
        const event = JSON.parse(envelope.data);
        return event.type === 'response.failed';
      });
      
      expect(failedCall).toBeDefined();
    });

    it('should include error code in failed event', async () => {
      // Create a dispatcher that will fail
      const config = {
        requestTimeout: 30000,
        maxConcurrentRequests: 5,
        debug: true,
      };
      const failingDispatcher = new SDKDispatcher(config, mockLogger);

      // Mock SDK dispatch to throw error
      vi.spyOn(failingDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('SDK error')
      );

      // Dispatch a request that will fail
      const dispatchPromise = failingDispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_009' },
        mockWs
      );

      // Wait for error handling
      await vi.advanceTimersByTimeAsync(150);

      // Find failed event and check error code
      const calls = (mockWs.send as any).mock.calls;
      const failedCall = calls.find((call: any) => {
        const envelope = JSON.parse(call[0]);
        const event = JSON.parse(envelope.data);
        return event.type === 'response.failed';
      });
      
      expect(failedCall).toBeDefined();
      const envelope = JSON.parse(failedCall[0]);
      const event = JSON.parse(envelope.data);
      expect(event.error).toBeDefined();
      expect(event.error.code).toBe('SDK_ERROR');
    });
  });

  describe('Complete event sequence', () => {
    it('should generate complete event sequence for successful request', async () => {
      // Create dispatcher
      const config = {
        requestTimeout: 30000,
        maxConcurrentRequests: 5,
        debug: true,
      };
      dispatcher = new SDKDispatcher(config, mockLogger);

      // Dispatch a request
      const dispatchPromise = dispatcher.dispatchRequest(
        { content: 'test', messageId: 'msg_010' },
        mockWs
      );

      // Wait for completion
      await vi.advanceTimersByTimeAsync(250);

      // Get all event types
      const calls = (mockWs.send as any).mock.calls;
      const events = calls.map((call: any) => {
        const envelope = JSON.parse(call[0]);
        const event = JSON.parse(envelope.data);
        return event.type;
      });
      
      // Verify complete sequence
      expect(events).toEqual([
        'response.in_progress',
        'response.output_item.added',
        'response.output_text.delta',
        'response.content_part.done',
        'response.completed',
      ]);
    });
  });
});
