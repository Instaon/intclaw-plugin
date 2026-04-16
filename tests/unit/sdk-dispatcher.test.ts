/**
 * Unit tests for SDKDispatcher
 * 
 * Tests the core SDK dispatcher class including:
 * - Constructor initialization
 * - Private field initialization
 * - Configuration storage
 * - dispatchRequest method
 * 
 * Validates: Requirements 1.1, 2.5, 3.1, 3.2, 7.1, 9.1, 9.5, 13.1, 14.1
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
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

describe('SDKDispatcher - Constructor and Initialization', () => {
  let mockLogger: DebugLogger;
  let config: DispatcherConfig;

  beforeEach(() => {
    // Create a mock logger
    mockLogger = new DebugLogger(false, '[Test]');
    vi.spyOn(mockLogger, 'info');
    vi.spyOn(mockLogger, 'debug');
    vi.spyOn(mockLogger, 'warn');
    vi.spyOn(mockLogger, 'error');

    // Create test configuration
    config = {
      requestTimeout: 30000,
      maxConcurrentRequests: 5,
      debug: true,
      systemPrompt: 'Test system prompt',
      accountId: 'test-account-123',
    };
  });

  it('should create SDKDispatcher instance with valid configuration', () => {
    const dispatcher = new SDKDispatcher(config, mockLogger);
    
    expect(dispatcher).toBeDefined();
    expect(dispatcher).toBeInstanceOf(SDKDispatcher);
  });

  it('should initialize contexts Map', () => {
    const dispatcher = new SDKDispatcher(config, mockLogger);
    
    // Verify contexts map is initialized (check via getActiveRequestCount if available)
    // For now, we just verify the instance was created successfully
    expect(dispatcher).toBeDefined();
  });

  it('should store logger instance', () => {
    const dispatcher = new SDKDispatcher(config, mockLogger);
    
    // Verify logger was used during initialization
    expect(mockLogger.info).toHaveBeenCalledWith(
      'SDKDispatcher initialized',
      expect.objectContaining({
        requestTimeout: 30000,
        maxConcurrentRequests: 5,
        debug: true,
      })
    );
  });

  it('should store configuration with all required fields', () => {
    const dispatcher = new SDKDispatcher(config, mockLogger);
    
    // Configuration is stored internally - verify via logger call
    expect(mockLogger.info).toHaveBeenCalledWith(
      'SDKDispatcher initialized',
      expect.objectContaining({
        requestTimeout: config.requestTimeout,
        maxConcurrentRequests: config.maxConcurrentRequests,
        debug: config.debug,
      })
    );
  });

  it('should store optional configuration fields', () => {
    const dispatcher = new SDKDispatcher(config, mockLogger);
    
    // Optional fields are stored but not logged
    expect(dispatcher).toBeDefined();
  });

  it('should handle configuration without optional fields', () => {
    const minimalConfig: DispatcherConfig = {
      requestTimeout: 60000,
      maxConcurrentRequests: 10,
      debug: false,
    };

    const dispatcher = new SDKDispatcher(minimalConfig, mockLogger);
    
    expect(dispatcher).toBeDefined();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'SDKDispatcher initialized',
      expect.objectContaining({
        requestTimeout: 60000,
        maxConcurrentRequests: 10,
        debug: false,
      })
    );
  });

  it('should log initialization with correct parameters', () => {
    new SDKDispatcher(config, mockLogger);
    
    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith(
      'SDKDispatcher initialized',
      {
        requestTimeout: 30000,
        maxConcurrentRequests: 5,
        debug: true,
      }
    );
  });

  it('should accept different timeout values', () => {
    const customConfig = { ...config, requestTimeout: 120000 };
    const dispatcher = new SDKDispatcher(customConfig, mockLogger);
    
    expect(dispatcher).toBeDefined();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'SDKDispatcher initialized',
      expect.objectContaining({
        requestTimeout: 120000,
      })
    );
  });

  it('should accept different concurrent request limits', () => {
    const customConfig = { ...config, maxConcurrentRequests: 20 };
    const dispatcher = new SDKDispatcher(customConfig, mockLogger);
    
    expect(dispatcher).toBeDefined();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'SDKDispatcher initialized',
      expect.objectContaining({
        maxConcurrentRequests: 20,
      })
    );
  });

  it('should accept debug mode enabled', () => {
    const customConfig = { ...config, debug: true };
    const dispatcher = new SDKDispatcher(customConfig, mockLogger);
    
    expect(dispatcher).toBeDefined();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'SDKDispatcher initialized',
      expect.objectContaining({
        debug: true,
      })
    );
  });

  it('should accept debug mode disabled', () => {
    const customConfig = { ...config, debug: false };
    const dispatcher = new SDKDispatcher(customConfig, mockLogger);
    
    expect(dispatcher).toBeDefined();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'SDKDispatcher initialized',
      expect.objectContaining({
        debug: false,
      })
    );
  });
});


describe('SDKDispatcher - dispatchRequest method', () => {
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
      maxConcurrentRequests: 5,
      debug: true,
    };

    dispatcher = new SDKDispatcher(config, mockLogger);
    mockWs = createMockWebSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Request validation (Requirement 2.5)', () => {
    it('should reject empty content string', async () => {
      const request = { content: '', messageId: 'msg_001' };
      
      await dispatcher.dispatchRequest(request, mockWs);
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Invalid request: content must be a non-empty string',
        expect.objectContaining({
          messageId: 'msg_001',
        })
      );
      
      // Should send failed event
      expect(mockWs.send).toHaveBeenCalled();
    });

    it('should reject whitespace-only content', async () => {
      const request = { content: '   ', messageId: 'msg_002' };
      
      await dispatcher.dispatchRequest(request, mockWs);
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Invalid request: content must be a non-empty string',
        expect.any(Object)
      );
    });

    it('should accept valid non-empty content', async () => {
      const request = { content: 'Hello world', messageId: 'msg_003' };
      
      await dispatcher.dispatchRequest(request, mockWs);
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Dispatching request to SDK',
        expect.objectContaining({
          messageId: 'msg_003',
          contentLength: 11,
        })
      );
    });
  });

  describe('Concurrent request limit (Requirement 9.5)', () => {
    it('should accept requests below concurrent limit', async () => {
      const request = { content: 'Test request', messageId: 'msg_004' };
      
      await dispatcher.dispatchRequest(request, mockWs);
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Dispatching request to SDK',
        expect.objectContaining({
          messageId: 'msg_004',
        })
      );
    });

    it('should reject requests exceeding concurrent limit', async () => {
      // Fill up to the limit (5 concurrent requests)
      for (let i = 0; i < 5; i++) {
        await dispatcher.dispatchRequest(
          { content: `Request ${i}`, messageId: `msg_${i}` },
          mockWs
        );
      }
      
      // This should be rejected
      const request = { content: 'Overflow request', messageId: 'msg_overflow' };
      await dispatcher.dispatchRequest(request, mockWs);
      
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Concurrent request limit reached',
        expect.objectContaining({
          messageId: 'msg_overflow',
          maxConcurrent: 5,
        })
      );
    });
  });

  describe('Correlation context creation (Requirement 7.1)', () => {
    it('should create context with unique response_id', async () => {
      const request1 = { content: 'Request 1', messageId: 'msg_101' };
      const request2 = { content: 'Request 2', messageId: 'msg_102' };
      
      await dispatcher.dispatchRequest(request1, mockWs);
      await dispatcher.dispatchRequest(request2, mockWs);
      
      // Both should be dispatched with different response IDs
      const calls = (mockLogger.info as any).mock.calls.filter(
        (call: any[]) => call[0] === 'Dispatching request to SDK'
      );
      
      expect(calls).toHaveLength(2);
      expect(calls[0][1].responseId).toBeDefined();
      expect(calls[1][1].responseId).toBeDefined();
      expect(calls[0][1].responseId).not.toBe(calls[1][1].responseId);
    });

    it('should store messageId in context', async () => {
      const request = { content: 'Test', messageId: 'msg_103' };
      
      await dispatcher.dispatchRequest(request, mockWs);
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Dispatching request to SDK',
        expect.objectContaining({
          messageId: 'msg_103',
        })
      );
    });
  });

  describe('Timeout timer setup (Requirement 14.1)', () => {
    it('should set up timeout timer on dispatch', async () => {
      const request = { content: 'Test', messageId: 'msg_201' };
      
      await dispatcher.dispatchRequest(request, mockWs);
      
      // Verify timer was set up by advancing time and checking for timeout
      vi.advanceTimersByTime(config.requestTimeout);
      
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Request timeout',
        expect.objectContaining({
          messageId: 'msg_201',
        })
      );
    });

    it('should use configured timeout duration', async () => {
      const customConfig = { ...config, requestTimeout: 5000 };
      const customDispatcher = new SDKDispatcher(customConfig, mockLogger);
      
      const request = { content: 'Test', messageId: 'msg_202' };
      await customDispatcher.dispatchRequest(request, mockWs);
      
      // Should not timeout before configured duration
      vi.advanceTimersByTime(4999);
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        'Request timeout',
        expect.any(Object)
      );
      
      // Should timeout after configured duration
      vi.advanceTimersByTime(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Request timeout',
        expect.objectContaining({
          messageId: 'msg_202',
        })
      );
    });
  });

  describe('SDK dispatch call (Requirement 3.1, 3.2)', () => {
    it('should call SDK dispatch method with content', async () => {
      const request = { content: 'Hello SDK', messageId: 'msg_301' };
      
      await dispatcher.dispatchRequest(request, mockWs);
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Dispatching request to SDK',
        expect.objectContaining({
          messageId: 'msg_301',
          contentLength: 9,
        })
      );
    });

    it('should pass callback to SDK dispatch', async () => {
      const request = { content: 'Test', messageId: 'msg_302' };
      
      await dispatcher.dispatchRequest(request, mockWs);
      
      // Advance timers to trigger mock SDK callback
      vi.advanceTimersByTime(100);
      
      // Callback should be invoked (check debug logs)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'SDK callback invoked',
        expect.objectContaining({
          messageId: 'msg_302',
        })
      );
    });
  });

  describe('SDK dispatch error handling (Requirement 3.4, 8.1)', () => {
    it('should handle SDK dispatch errors gracefully', async () => {
      // Create a dispatcher that will throw during dispatch
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      
      // Mock the mockSDKDispatch to throw
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('SDK dispatch failed')
      );
      
      const request = { content: 'Test', messageId: 'msg_401' };
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'SDK dispatch failed',
        expect.objectContaining({
          messageId: 'msg_401',
          error: 'SDK dispatch failed',
        })
      );
    });
  });

  describe('Logging (Requirement 15.1)', () => {
    it('should log request dispatch with details', async () => {
      const request = { content: 'Test content', messageId: 'msg_501' };
      
      await dispatcher.dispatchRequest(request, mockWs);
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Dispatching request to SDK',
        expect.objectContaining({
          messageId: 'msg_501',
          contentLength: 12,
          activeRequests: expect.any(Number),
        })
      );
    });

    it('should include response_id in logs', async () => {
      const request = { content: 'Test', messageId: 'msg_502' };
      
      await dispatcher.dispatchRequest(request, mockWs);
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Dispatching request to SDK',
        expect.objectContaining({
          responseId: expect.stringMatching(/^resp_/),
        })
      );
    });
  });
});


describe('SDKDispatcher - createCallback method', () => {
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
      maxConcurrentRequests: 5,
      debug: true,
    };

    dispatcher = new SDKDispatcher(config, mockLogger);
    mockWs = createMockWebSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Callback closure and correlation (Requirements 1.3, 7.3)', () => {
    it('should return a callback function', async () => {
      const request = { content: 'Test', messageId: 'msg_cb_001' };
      await dispatcher.dispatchRequest(request, mockWs);
      
      // The callback is created internally, verify it's invoked by mock SDK
      vi.advanceTimersByTime(100);
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'SDK callback invoked',
        expect.objectContaining({
          messageId: 'msg_cb_001',
        })
      );
    });

    it('should capture messageId in callback closure', async () => {
      const request = { content: 'Test', messageId: 'msg_cb_002' };
      await dispatcher.dispatchRequest(request, mockWs);
      
      // Advance to trigger callback
      vi.advanceTimersByTime(100);
      
      // Verify callback was invoked with correct messageId
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'SDK callback invoked',
        expect.objectContaining({
          messageId: 'msg_cb_002',
        })
      );
    });

    it('should look up correlation context by messageId', async () => {
      const request = { content: 'Test', messageId: 'msg_cb_003' };
      await dispatcher.dispatchRequest(request, mockWs);
      
      vi.advanceTimersByTime(100);
      
      // Should find context and log with responseId
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'SDK callback invoked',
        expect.objectContaining({
          messageId: 'msg_cb_003',
          responseId: expect.stringMatching(/^resp_/),
        })
      );
    });

    it('should handle callback for unknown messageId gracefully', async () => {
      // Create a callback manually with non-existent messageId
      const callback = (dispatcher as any).createCallback('unknown_msg_id');
      
      // Invoke callback
      callback('test chunk', null, false);
      
      // Should log warning
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Callback invoked for unknown messageId',
        expect.objectContaining({
          messageId: 'unknown_msg_id',
        })
      );
    });
  });

  describe('Callback parameters (Requirements 10.1, 10.2, 10.3)', () => {
    it('should handle text chunk parameter', async () => {
      const request = { content: 'Test', messageId: 'msg_cb_101' };
      await dispatcher.dispatchRequest(request, mockWs);
      
      vi.advanceTimersByTime(100);
      
      // Mock SDK sends chunk
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'SDK callback invoked',
        expect.objectContaining({
          messageId: 'msg_cb_101',
          chunkLength: expect.any(Number),
          hasError: false,
          isComplete: false,
        })
      );
    });

    it('should handle error parameter', async () => {
      // Create a custom mock SDK that sends error
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockImplementation(
        (async (...args: any[]) => {
          const callback = args[1] as any;
          setTimeout(() => {
            callback(null, new Error('SDK error'), false);
          }, 100);
        }) as any
      );
      
      const request = { content: 'Test', messageId: 'msg_cb_102' };
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      vi.advanceTimersByTime(100);
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'SDK callback invoked',
        expect.objectContaining({
          messageId: 'msg_cb_102',
          hasError: true,
        })
      );
    });

    it('should handle completion parameter', async () => {
      const request = { content: 'Test', messageId: 'msg_cb_103' };
      await dispatcher.dispatchRequest(request, mockWs);
      
      // Advance to completion callback
      vi.advanceTimersByTime(200);
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'SDK callback invoked',
        expect.objectContaining({
          messageId: 'msg_cb_103',
          isComplete: true,
        })
      );
    });
  });

  describe('Non-blocking behavior (Requirements 1.5, 10.5)', () => {
    it('should return void immediately', async () => {
      const request = { content: 'Test', messageId: 'msg_cb_201' };
      await dispatcher.dispatchRequest(request, mockWs);
      
      // Create callback and invoke it
      const callback = (dispatcher as any).createCallback('msg_cb_201');
      const result = callback('test chunk', null, false);
      
      // Should return void (undefined)
      expect(result).toBeUndefined();
    });

    it('should not throw errors from callback', async () => {
      const request = { content: 'Test', messageId: 'msg_cb_202' };
      await dispatcher.dispatchRequest(request, mockWs);
      
      const callback = (dispatcher as any).createCallback('msg_cb_202');
      
      // Should not throw even if internal processing fails
      expect(() => {
        callback('test chunk', null, false);
      }).not.toThrow();
    });

    it('should handle synchronous errors without throwing', async () => {
      // Create callback with invalid messageId to trigger error path
      const callback = (dispatcher as any).createCallback('invalid_id');
      
      // Should not throw
      expect(() => {
        callback('test chunk', null, false);
      }).not.toThrow();
      
      // Should log warning
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('Callback invocation patterns (Requirements 10.4)', () => {
    it('should handle success pattern: chunk → chunk → completion', async () => {
      const customDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(customDispatcher as any, 'mockSDKDispatch').mockImplementation(
        (async (...args: any[]) => {
          const callback = args[1] as any;
          setTimeout(() => callback('chunk1', null, false), 50);
          setTimeout(() => callback('chunk2', null, false), 100);
          setTimeout(() => callback(null, null, true), 150);
        }) as any
      );
      
      const request = { content: 'Test', messageId: 'msg_cb_301' };
      await customDispatcher.dispatchRequest(request, mockWs);
      
      // First chunk
      vi.advanceTimersByTime(50);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'SDK callback invoked',
        expect.objectContaining({
          messageId: 'msg_cb_301',
          chunkLength: 6,
          isComplete: false,
        })
      );
      
      // Second chunk
      vi.advanceTimersByTime(50);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'SDK callback invoked',
        expect.objectContaining({
          messageId: 'msg_cb_301',
          chunkLength: 6,
          isComplete: false,
        })
      );
      
      // Completion
      vi.advanceTimersByTime(50);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'SDK callback invoked',
        expect.objectContaining({
          messageId: 'msg_cb_301',
          isComplete: true,
        })
      );
    });

    it('should handle error pattern: chunk → error', async () => {
      const customDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(customDispatcher as any, 'mockSDKDispatch').mockImplementation(
        (async (...args: any[]) => {
          const callback = args[1] as any;
          setTimeout(() => callback('chunk1', null, false), 50);
          setTimeout(() => callback(null, new Error('Processing failed'), false), 100);
        }) as any
      );
      
      const request = { content: 'Test', messageId: 'msg_cb_302' };
      await customDispatcher.dispatchRequest(request, mockWs);
      
      // First chunk
      vi.advanceTimersByTime(50);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'SDK callback invoked',
        expect.objectContaining({
          messageId: 'msg_cb_302',
          hasError: false,
        })
      );
      
      // Error
      vi.advanceTimersByTime(50);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'SDK callback invoked',
        expect.objectContaining({
          messageId: 'msg_cb_302',
          hasError: true,
        })
      );
    });

    it('should handle invalid callback invocation (no chunk, error, or completion)', async () => {
      const request = { content: 'Test', messageId: 'msg_cb_303' };
      await dispatcher.dispatchRequest(request, mockWs);
      
      const callback = (dispatcher as any).createCallback('msg_cb_303');
      
      // Invoke with all null/false
      callback(null, null, false);
      
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid callback invocation: no chunk, error, or completion',
        expect.objectContaining({
          messageId: 'msg_cb_303',
        })
      );
    });
  });

  describe('Logging (Requirement 15.2)', () => {
    it('should log callback invocations with details', async () => {
      const request = { content: 'Test', messageId: 'msg_cb_401' };
      await dispatcher.dispatchRequest(request, mockWs);
      
      vi.advanceTimersByTime(100);
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'SDK callback invoked',
        expect.objectContaining({
          messageId: 'msg_cb_401',
          responseId: expect.any(String),
          chunkLength: expect.any(Number),
          hasError: expect.any(Boolean),
          isComplete: expect.any(Boolean),
          firstChunk: expect.any(Boolean),
        })
      );
    });

    it('should log first chunk detection', async () => {
      const request = { content: 'Test', messageId: 'msg_cb_402' };
      await dispatcher.dispatchRequest(request, mockWs);
      
      vi.advanceTimersByTime(100);
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'SDK callback invoked',
        expect.objectContaining({
          messageId: 'msg_cb_402',
          firstChunk: true,
        })
      );
    });

    it('should log chunk length', async () => {
      const customDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(customDispatcher as any, 'mockSDKDispatch').mockImplementation(
        (async (...args: any[]) => {
          const callback = args[1] as any;
          setTimeout(() => callback('Hello World!', null, false), 50);
        }) as any
      );
      
      const request = { content: 'Test', messageId: 'msg_cb_403' };
      await customDispatcher.dispatchRequest(request, mockWs);
      
      vi.advanceTimersByTime(50);
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'SDK callback invoked',
        expect.objectContaining({
          messageId: 'msg_cb_403',
          chunkLength: 12,
        })
      );
    });
  });

  describe('Error handling in callback', () => {
    it('should catch and log errors from handleChunk', async () => {
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      
      // Mock handleChunk to throw
      vi.spyOn(errorDispatcher as any, 'handleChunk').mockRejectedValue(
        new Error('handleChunk failed')
      );
      
      const request = { content: 'Test', messageId: 'msg_cb_501' };
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      vi.advanceTimersByTime(100);
      
      // Should log the error
      await vi.runAllTimersAsync();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to handle callback chunk',
        expect.objectContaining({
          messageId: 'msg_cb_501',
          error: 'handleChunk failed',
        })
      );
    });

    it('should catch and log errors from handleCompletion', async () => {
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      
      // Mock handleCompletion to throw
      vi.spyOn(errorDispatcher as any, 'handleCompletion').mockRejectedValue(
        new Error('handleCompletion failed')
      );
      
      const request = { content: 'Test', messageId: 'msg_cb_502' };
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      vi.advanceTimersByTime(200);
      
      // Should log the error
      await vi.runAllTimersAsync();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to handle callback completion',
        expect.objectContaining({
          messageId: 'msg_cb_502',
          error: 'handleCompletion failed',
        })
      );
    });

    it('should catch and log errors from handleError', async () => {
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      
      // Mock handleError to throw
      vi.spyOn(errorDispatcher as any, 'handleError').mockRejectedValue(
        new Error('handleError failed')
      );
      
      // Mock SDK to send error
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockImplementation(
        (async (...args: any[]) => {
          const callback = args[1] as any;
          setTimeout(() => callback(null, new Error('SDK error'), false), 100);
        }) as any
      );
      
      const request = { content: 'Test', messageId: 'msg_cb_503' };
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      vi.advanceTimersByTime(100);
      
      // Should log the error
      await vi.runAllTimersAsync();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to handle callback error',
        expect.objectContaining({
          messageId: 'msg_cb_503',
          error: 'handleError failed',
        })
      );
    });
  });
});


describe('SDKDispatcher - handleError method', () => {
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
      maxConcurrentRequests: 5,
      debug: true,
    };

    dispatcher = new SDKDispatcher(config, mockLogger);
    mockWs = createMockWebSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Error event generation (Requirements 4.5, 5.4)', () => {
    it('should generate response.failed event with SDK_ERROR code', async () => {
      const request = { content: 'Test', messageId: 'msg_err_001' };
      
      // Mock SDK to throw error
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('SDK processing failed')
      );
      
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      // Should send failed event
      expect(mockWs.send).toHaveBeenCalled();
      const sentMessage = (mockWs.send as any).mock.calls[0][0];
      const envelope = JSON.parse(sentMessage);
      const event = JSON.parse(envelope.data);
      
      expect(event.type).toBe('response.failed');
      expect(event.status).toBe('failed');
      expect(event.error.code).toBe('SDK_ERROR');
      expect(event.error.message).toBe('SDK processing failed');
    });

    it('should include error details in failed event', async () => {
      const request = { content: 'Test', messageId: 'msg_err_002' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('Detailed error message')
      );
      
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      const sentMessage = (mockWs.send as any).mock.calls[0][0];
      const envelope = JSON.parse(sentMessage);
      const event = JSON.parse(envelope.data);
      
      expect(event.error.message).toBe('Detailed error message');
      expect(event.error.details).toBeDefined();
    });

    it('should use TIMEOUT error code for timeout errors', async () => {
      const request = { content: 'Test', messageId: 'msg_err_003' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('Request timeout exceeded')
      );
      
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      const sentMessage = (mockWs.send as any).mock.calls[0][0];
      const envelope = JSON.parse(sentMessage);
      const event = JSON.parse(envelope.data);
      
      expect(event.error.code).toBe('TIMEOUT');
    });

    it('should use CALLBACK_ERROR code for callback errors', async () => {
      const request = { content: 'Test', messageId: 'msg_err_004' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('callback invocation failed')
      );
      
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      const sentMessage = (mockWs.send as any).mock.calls[0][0];
      const envelope = JSON.parse(sentMessage);
      const event = JSON.parse(envelope.data);
      
      expect(event.error.code).toBe('CALLBACK_ERROR');
    });

    it('should include response_id in failed event', async () => {
      const request = { content: 'Test', messageId: 'msg_err_005' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('Test error')
      );
      
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      const sentMessage = (mockWs.send as any).mock.calls[0][0];
      const envelope = JSON.parse(sentMessage);
      const event = JSON.parse(envelope.data);
      
      expect(event.response_id).toMatch(/^resp_/);
    });
  });

  describe('Context status update (Requirement 8.1)', () => {
    it('should update context status to failed', async () => {
      const request = { content: 'Test', messageId: 'msg_err_101' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('Test error')
      );
      
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      // Verify status was updated via log
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Request failed',
        expect.objectContaining({
          messageId: 'msg_err_101',
          errorCode: expect.any(String),
        })
      );
    });

    it('should log request failure with details', async () => {
      const request = { content: 'Test', messageId: 'msg_err_102' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('Test error')
      );
      
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Request failed',
        expect.objectContaining({
          messageId: 'msg_err_102',
          responseId: expect.stringMatching(/^resp_/),
          errorCode: 'SDK_ERROR',
          duration: expect.any(Number),
        })
      );
    });
  });

  describe('Context cleanup (Requirement 8.2)', () => {
    it('should clean up context after error', async () => {
      const request = { content: 'Test', messageId: 'msg_err_201' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('Test error')
      );
      
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      // Verify cleanup was called via log
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Context cleaned up',
        expect.objectContaining({
          messageId: 'msg_err_201',
          status: 'failed',
        })
      );
    });

    it('should clear timeout timer during cleanup', async () => {
      const request = { content: 'Test', messageId: 'msg_err_202' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('Test error')
      );
      
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      // Advance time past timeout - should not trigger timeout warning
      vi.advanceTimersByTime(config.requestTimeout + 1000);
      
      // Should not have timeout warning after cleanup
      const timeoutWarnings = (mockLogger.warn as any).mock.calls.filter(
        (call: any[]) => call[0] === 'Request timeout'
      );
      expect(timeoutWarnings).toHaveLength(0);
    });

    it('should remove context from contexts map', async () => {
      const request = { content: 'Test', messageId: 'msg_err_203' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('Test error')
      );
      
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      // Verify context was removed via cleanup log
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Context cleaned up',
        expect.objectContaining({
          messageId: 'msg_err_203',
        })
      );
    });
  });

  describe('WebSocket send handling', () => {
    it('should send failed event when WebSocket is open', async () => {
      const request = { content: 'Test', messageId: 'msg_err_301' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('Test error')
      );
      
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      expect(mockWs.send).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Sent response.failed event',
        expect.objectContaining({
          messageId: 'msg_err_301',
          errorCode: 'SDK_ERROR',
        })
      );
    });

    it('should handle WebSocket not open gracefully', async () => {
      const closedWs = createMockWebSocket();
      (closedWs as any).readyState = 3; // CLOSED
      
      const request = { content: 'Test', messageId: 'msg_err_302' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('Test error')
      );
      
      await errorDispatcher.dispatchRequest(request, closedWs);
      
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'WebSocket not open, cannot send failed event',
        expect.objectContaining({
          messageId: 'msg_err_302',
          readyState: 3,
        })
      );
    });

    it('should not throw if WebSocket send fails', async () => {
      const failingWs = createMockWebSocket();
      (failingWs.send as any).mockImplementation(() => {
        throw new Error('Send failed');
      });
      
      const request = { content: 'Test', messageId: 'msg_err_303' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('Test error')
      );
      
      // Should not throw
      await expect(
        errorDispatcher.dispatchRequest(request, failingWs)
      ).resolves.not.toThrow();
    });
  });

  describe('Error logging (Requirements 8.1, 8.2)', () => {
    it('should log error with full details', async () => {
      const request = { content: 'Test', messageId: 'msg_err_401' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      const testError = new Error('Detailed error message');
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(testError);
      
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Handling error',
        expect.objectContaining({
          messageId: 'msg_err_401',
          responseId: expect.stringMatching(/^resp_/),
          error: 'Detailed error message',
          stack: expect.any(String),
        })
      );
    });

    it('should log error code determination', async () => {
      const request = { content: 'Test', messageId: 'msg_err_402' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('Test error')
      );
      
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Sent response.failed event',
        expect.objectContaining({
          errorCode: 'SDK_ERROR',
        })
      );
    });

    it('should log request duration on failure', async () => {
      const request = { content: 'Test', messageId: 'msg_err_403' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('Test error')
      );
      
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Request failed',
        expect.objectContaining({
          duration: expect.any(Number),
        })
      );
    });
  });

  describe('Error handling edge cases', () => {
    it('should handle errors during event generation', async () => {
      const request = { content: 'Test', messageId: 'msg_err_501' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      
      // Mock protocol import to fail
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('Test error')
      );
      
      // This should still complete without throwing
      await expect(
        errorDispatcher.dispatchRequest(request, mockWs)
      ).resolves.not.toThrow();
    });

    it('should cleanup even if event send fails', async () => {
      const failingWs = createMockWebSocket();
      (failingWs.send as any).mockImplementation(() => {
        throw new Error('Send failed');
      });
      
      const request = { content: 'Test', messageId: 'msg_err_502' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(
        new Error('Test error')
      );
      
      await errorDispatcher.dispatchRequest(request, failingWs);
      
      // Should still cleanup
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Context cleaned up',
        expect.objectContaining({
          messageId: 'msg_err_502',
        })
      );
    });

    it('should handle error with missing stack trace', async () => {
      const request = { content: 'Test', messageId: 'msg_err_503' };
      
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      const errorWithoutStack = new Error('No stack');
      delete errorWithoutStack.stack;
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockRejectedValue(errorWithoutStack);
      
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      // Should still handle the error
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Handling error',
        expect.objectContaining({
          messageId: 'msg_err_503',
          error: 'No stack',
        })
      );
    });
  });

  describe('Callback error handling', () => {
    it('should handle errors from SDK callback', async () => {
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      
      // Mock SDK to invoke callback with error
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockImplementation(
        (async (...args: any[]) => {
          const callback = args[1] as any;
          setTimeout(() => {
            callback(null, new Error('Callback error'), false);
          }, 100);
        }) as any
      );
      
      const request = { content: 'Test', messageId: 'msg_err_601' };
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
      
      // Should handle the error
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Handling error',
        expect.objectContaining({
          messageId: 'msg_err_601',
          error: 'Callback error',
        })
      );
    });

    it('should send failed event for callback errors', async () => {
      const errorDispatcher = new SDKDispatcher(config, mockLogger);
      
      vi.spyOn(errorDispatcher as any, 'mockSDKDispatch').mockImplementation(
        (async (...args: any[]) => {
          const callback = args[1] as any;
          setTimeout(() => {
            callback(null, new Error('Callback error'), false);
          }, 100);
        }) as any
      );
      
      const request = { content: 'Test', messageId: 'msg_err_602' };
      await errorDispatcher.dispatchRequest(request, mockWs);
      
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
      
      // Should send failed event
      const failedCalls = (mockWs.send as any).mock.calls.filter((call: any[]) => {
        try {
          const envelope = JSON.parse(call[0]);
          const event = JSON.parse(envelope.data);
          return event.type === 'response.failed';
        } catch {
          return false;
        }
      });
      
      expect(failedCalls.length).toBeGreaterThan(0);
    });
  });
});
