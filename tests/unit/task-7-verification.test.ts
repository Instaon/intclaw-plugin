/**
 * Verification tests for Task 7: Concurrent Request Support
 * 
 * This test file verifies that task 7 subtasks are correctly implemented:
 * - 7.1: Concurrent request limit enforcement
 * - 7.2: getActiveRequestCount method (public)
 * - 7.3: cleanupContext method (private, tested indirectly)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SDKDispatcher, type DispatcherConfig } from '../../sdk-dispatcher.js';
import { DebugLogger } from '../../logger.js';
import type { WebSocket } from 'ws';

// Mock WebSocket
const createMockWebSocket = (): WebSocket => {
  return {
    readyState: 1, // OPEN
    send: vi.fn(),
  } as unknown as WebSocket;
};

describe('Task 7: Concurrent Request Support', () => {
  let mockLogger: DebugLogger;
  let config: DispatcherConfig;
  let dispatcher: SDKDispatcher;
  let mockWs: WebSocket;

  beforeEach(() => {
    vi.clearAllTimers();
    vi.useFakeTimers();
    
    mockLogger = new DebugLogger(false, '[Test]');
    vi.spyOn(mockLogger, 'info');
    vi.spyOn(mockLogger, 'debug');
    vi.spyOn(mockLogger, 'warn');
    vi.spyOn(mockLogger, 'error');

    config = {
      requestTimeout: 30000,
      maxConcurrentRequests: 3,
      debug: true,
    };

    dispatcher = new SDKDispatcher(config, mockLogger);
    mockWs = createMockWebSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('7.1: Concurrent request limit enforcement', () => {
    it('should check active request count before accepting new requests', async () => {
      // Initially, active count should be 0
      expect(dispatcher.getActiveRequestCount()).toBe(0);
      
      // Dispatch first request
      await dispatcher.dispatchRequest(
        { content: 'Request 1', messageId: 'msg_1' },
        mockWs
      );
      
      // Active count should be 1
      expect(dispatcher.getActiveRequestCount()).toBe(1);
      
      // Dispatch second request
      await dispatcher.dispatchRequest(
        { content: 'Request 2', messageId: 'msg_2' },
        mockWs
      );
      
      // Active count should be 2
      expect(dispatcher.getActiveRequestCount()).toBe(2);
    });

    it('should reject requests exceeding maxConcurrentRequests', async () => {
      // Fill up to the limit (3 concurrent requests)
      await dispatcher.dispatchRequest(
        { content: 'Request 1', messageId: 'msg_1' },
        mockWs
      );
      await dispatcher.dispatchRequest(
        { content: 'Request 2', messageId: 'msg_2' },
        mockWs
      );
      await dispatcher.dispatchRequest(
        { content: 'Request 3', messageId: 'msg_3' },
        mockWs
      );
      
      // Active count should be at limit
      expect(dispatcher.getActiveRequestCount()).toBe(3);
      
      // This should be rejected
      await dispatcher.dispatchRequest(
        { content: 'Request 4', messageId: 'msg_4' },
        mockWs
      );
      
      // Should log warning about limit reached
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Concurrent request limit reached',
        expect.objectContaining({
          messageId: 'msg_4',
          activeCount: 3,
          maxConcurrent: 3,
        })
      );
      
      // Active count should still be 3 (rejected request not added)
      expect(dispatcher.getActiveRequestCount()).toBe(3);
    });

    it('should generate failed event for rejected requests', async () => {
      // Fill up to the limit
      for (let i = 0; i < 3; i++) {
        await dispatcher.dispatchRequest(
          { content: `Request ${i}`, messageId: `msg_${i}` },
          mockWs
        );
      }
      
      // Clear previous send calls
      (mockWs.send as any).mockClear();
      
      // This should be rejected and generate failed event
      await dispatcher.dispatchRequest(
        { content: 'Overflow request', messageId: 'msg_overflow' },
        mockWs
      );
      
      // Should send failed event
      expect(mockWs.send).toHaveBeenCalled();
      const sentMessage = (mockWs.send as any).mock.calls[0][0];
      const envelope = JSON.parse(sentMessage);
      const event = JSON.parse(envelope.data);
      
      expect(event.type).toBe('response.failed');
      expect(event.status).toBe('failed');
      expect(event.error.code).toBe('RATE_LIMIT');
      expect(event.error.message).toBe('Maximum concurrent requests exceeded');
    });
  });

  describe('7.2: getActiveRequestCount method', () => {
    it('should be a public method', () => {
      // Verify the method exists and is callable
      expect(typeof dispatcher.getActiveRequestCount).toBe('function');
      expect(dispatcher.getActiveRequestCount()).toBe(0);
    });

    it('should return count of pending or processing contexts', async () => {
      // Initially 0
      expect(dispatcher.getActiveRequestCount()).toBe(0);
      
      // Add a request
      await dispatcher.dispatchRequest(
        { content: 'Test', messageId: 'msg_1' },
        mockWs
      );
      
      // Should be 1
      expect(dispatcher.getActiveRequestCount()).toBe(1);
      
      // Add another request
      await dispatcher.dispatchRequest(
        { content: 'Test 2', messageId: 'msg_2' },
        mockWs
      );
      
      // Should be 2
      expect(dispatcher.getActiveRequestCount()).toBe(2);
    });

    it('should not count completed requests', async () => {
      // Add a request
      await dispatcher.dispatchRequest(
        { content: 'Test', messageId: 'msg_1' },
        mockWs
      );
      
      expect(dispatcher.getActiveRequestCount()).toBe(1);
      
      // Complete the request by advancing timers
      vi.advanceTimersByTime(100); // First chunk
      await vi.runAllTimersAsync(); // Wait for async operations
      vi.advanceTimersByTime(100); // Completion
      await vi.runAllTimersAsync(); // Wait for async operations
      
      // After completion, active count should be 0
      expect(dispatcher.getActiveRequestCount()).toBe(0);
    });

    it('should not count failed requests', async () => {
      // Create a dispatcher that will throw during dispatch
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('SDK error')
      );
      
      // Add a request that will fail
      await errorDispatcher.dispatchRequest(
        { content: 'Test', messageId: 'msg_1' },
        mockWs
      );
      
      // After failure, active count should be 0
      expect(errorDispatcher.getActiveRequestCount()).toBe(0);
    });

    it('should not count timed-out requests', async () => {
      // Add a request
      await dispatcher.dispatchRequest(
        { content: 'Test', messageId: 'msg_1' },
        mockWs
      );
      
      expect(dispatcher.getActiveRequestCount()).toBe(1);
      
      // Advance time to trigger timeout
      vi.advanceTimersByTime(config.requestTimeout);
      
      // After timeout, active count should be 0
      expect(dispatcher.getActiveRequestCount()).toBe(0);
    });
  });

  describe('7.3: cleanupContext method (tested indirectly)', () => {
    it('should remove context from map after completion', async () => {
      // Add a request
      await dispatcher.dispatchRequest(
        { content: 'Test', messageId: 'msg_1' },
        mockWs
      );
      
      expect(dispatcher.getActiveRequestCount()).toBe(1);
      
      // Complete the request
      vi.advanceTimersByTime(100); // First chunk
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100); // Completion
      await vi.runAllTimersAsync();
      
      // Context should be cleaned up
      expect(dispatcher.getActiveRequestCount()).toBe(0);
    });

    it('should clear timeout timer during cleanup', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      
      // Add a request
      await dispatcher.dispatchRequest(
        { content: 'Test', messageId: 'msg_1' },
        mockWs
      );
      
      // Complete the request
      vi.advanceTimersByTime(100); // First chunk
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100); // Completion
      await vi.runAllTimersAsync();
      
      // clearTimeout should have been called
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should log cleanup action', async () => {
      // Add a request
      await dispatcher.dispatchRequest(
        { content: 'Test', messageId: 'msg_1' },
        mockWs
      );
      
      // Complete the request
      vi.advanceTimersByTime(100); // First chunk
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100); // Completion
      await vi.runAllTimersAsync();
      
      // Should log cleanup
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Context cleaned up',
        expect.objectContaining({
          messageId: 'msg_1',
          status: 'completed',
        })
      );
    });
  });

  describe('Integration: All three subtasks working together', () => {
    it('should enforce limit, track count, and cleanup correctly', async () => {
      // Start with 0 active requests
      expect(dispatcher.getActiveRequestCount()).toBe(0);
      
      // Add 3 requests (at limit)
      await dispatcher.dispatchRequest(
        { content: 'Request 1', messageId: 'msg_1' },
        mockWs
      );
      await dispatcher.dispatchRequest(
        { content: 'Request 2', messageId: 'msg_2' },
        mockWs
      );
      await dispatcher.dispatchRequest(
        { content: 'Request 3', messageId: 'msg_3' },
        mockWs
      );
      
      // Should be at limit
      expect(dispatcher.getActiveRequestCount()).toBe(3);
      
      // 4th request should be rejected
      await dispatcher.dispatchRequest(
        { content: 'Request 4', messageId: 'msg_4' },
        mockWs
      );
      
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Concurrent request limit reached',
        expect.any(Object)
      );
      
      // Still at limit (rejected request not added)
      expect(dispatcher.getActiveRequestCount()).toBe(3);
      
      // Complete first request
      vi.advanceTimersByTime(100); // First chunk for all 3
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100); // Completion for all 3
      await vi.runAllTimersAsync();
      
      // All requests completed and cleaned up
      expect(dispatcher.getActiveRequestCount()).toBe(0);
      
      // Now we can add new requests
      await dispatcher.dispatchRequest(
        { content: 'Request 5', messageId: 'msg_5' },
        mockWs
      );
      
      expect(dispatcher.getActiveRequestCount()).toBe(1);
    });
  });
});
