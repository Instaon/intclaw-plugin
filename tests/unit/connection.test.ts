/**
 * Unit Tests for WebSocket Connection Manager
 * 
 * Tests connection establishment, heartbeat, reconnection, and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketConnection } from '../../connection.js';
import { DebugLogger } from '../../logger.js';
import type { ConnectionConfig } from '../../types.js';

// Mock WebSocket
vi.mock('ws', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      once: vi.fn(),
      send: vi.fn(),
      ping: vi.fn(),
      close: vi.fn(),
      removeAllListeners: vi.fn(),
      readyState: 1, // OPEN
    })),
  };
});

describe('WebSocketConnection', () => {
  let connection: WebSocketConnection;
  let logger: DebugLogger;
  let config: ConnectionConfig;
  let onMessage: ReturnType<typeof vi.fn>;
  let onStateChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create logger
    logger = new DebugLogger(true, '[Test]');

    // Create config
    config = {
      wsUrl: 'wss://test.example.com/ws',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      enabled: true,
      heartbeatInterval: 1000, // 1 second for testing
      reconnectMaxAttempts: 3,
    };

    // Create callbacks
    onMessage = vi.fn();
    onStateChange = vi.fn();

    // Create connection
    connection = new WebSocketConnection(config, logger, onMessage, onStateChange);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with disconnected state', () => {
      expect(connection.getState()).toBe('disconnected');
      expect(connection.isConnected()).toBe(false);
    });
  });

  describe('Connection State', () => {
    it('should return current state', () => {
      const state = connection.getState();
      expect(state).toBe('disconnected');
    });

    it('should check if connected', () => {
      expect(connection.isConnected()).toBe(false);
    });
  });

  describe('Configuration Validation', () => {
    it('should not connect when enabled is false', async () => {
      const disabledConfig = { ...config, enabled: false };
      const disabledConnection = new WebSocketConnection(
        disabledConfig,
        logger,
        onMessage,
        onStateChange
      );

      await disabledConnection.connect();

      expect(disabledConnection.getState()).toBe('disconnected');
    });

    it('should not connect when clientId is empty', async () => {
      const invalidConfig = { ...config, clientId: '' };
      const invalidConnection = new WebSocketConnection(
        invalidConfig,
        logger,
        onMessage,
        onStateChange
      );

      await invalidConnection.connect();

      expect(invalidConnection.getState()).toBe('disconnected');
    });

    it('should not connect when clientSecret is empty', async () => {
      const invalidConfig = { ...config, clientSecret: '' };
      const invalidConnection = new WebSocketConnection(
        invalidConfig,
        logger,
        onMessage,
        onStateChange
      );

      await invalidConnection.connect();

      expect(invalidConnection.getState()).toBe('disconnected');
    });
  });
});
