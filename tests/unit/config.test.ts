/**
 * Unit Tests for Configuration Management Module
 * 
 * Tests the config.ts module constants for the channel-architecture-implementation spec.
 * Validates that all required constants are defined and have reasonable values.
 */

import { describe, it, expect } from 'vitest';
import {
  WS_URL,
  HEARTBEAT_INTERVAL,
  TIMEOUT_THRESHOLD,
  BASE_BACKOFF_DELAY,
  MAX_BACKOFF_DELAY,
  MAX_RECONNECT_ATTEMPTS,
  STALE_RESPONSE_THRESHOLD,
  TEXT_CHUNK_SIZE,
} from '../../config.js';

describe('Configuration Constants', () => {
  describe('WebSocket Connection Constants', () => {
    it('should define WS_URL constant', () => {
      expect(WS_URL).toBeDefined();
      expect(typeof WS_URL).toBe('string');
    });

    it('should have correct default WS_URL', () => {
      // If no environment variable is set, should use default
      if (!process.env['INSTACLAW_WS_URL']) {
        expect(WS_URL).toBe('wss://claw-dev.int-os.com/user-ws/');
      }
    });

    it('should use WSS protocol for secure connection', () => {
      expect(WS_URL).toMatch(/^wss:\/\//);
    });
  });

  describe('Heartbeat and Timeout Constants', () => {
    it('should define HEARTBEAT_INTERVAL constant', () => {
      expect(HEARTBEAT_INTERVAL).toBeDefined();
      expect(typeof HEARTBEAT_INTERVAL).toBe('number');
    });

    it('should have correct default HEARTBEAT_INTERVAL', () => {
      // If no environment variable is set, should use default 30 seconds
      if (!process.env['INSTACLAW_HEARTBEAT_INTERVAL']) {
        expect(HEARTBEAT_INTERVAL).toBe(30000);
      }
    });

    it('should define TIMEOUT_THRESHOLD constant', () => {
      expect(TIMEOUT_THRESHOLD).toBeDefined();
      expect(typeof TIMEOUT_THRESHOLD).toBe('number');
    });

    it('should have correct default TIMEOUT_THRESHOLD', () => {
      // If no environment variable is set, should use default 60 seconds
      if (!process.env['INSTACLAW_TIMEOUT_THRESHOLD']) {
        expect(TIMEOUT_THRESHOLD).toBe(60000);
      }
    });

    it('should have TIMEOUT_THRESHOLD greater than HEARTBEAT_INTERVAL', () => {
      expect(TIMEOUT_THRESHOLD).toBeGreaterThan(HEARTBEAT_INTERVAL);
    });

    it('should have reasonable heartbeat interval (between 10s and 120s)', () => {
      expect(HEARTBEAT_INTERVAL).toBeGreaterThanOrEqual(10000);
      expect(HEARTBEAT_INTERVAL).toBeLessThanOrEqual(120000);
    });

    it('should have reasonable timeout threshold (between 30s and 300s)', () => {
      expect(TIMEOUT_THRESHOLD).toBeGreaterThanOrEqual(30000);
      expect(TIMEOUT_THRESHOLD).toBeLessThanOrEqual(300000);
    });
  });

  describe('Reconnection Strategy Constants', () => {
    it('should define BASE_BACKOFF_DELAY constant', () => {
      expect(BASE_BACKOFF_DELAY).toBeDefined();
      expect(typeof BASE_BACKOFF_DELAY).toBe('number');
    });

    it('should have correct BASE_BACKOFF_DELAY value', () => {
      expect(BASE_BACKOFF_DELAY).toBe(1000);
    });

    it('should define MAX_BACKOFF_DELAY constant', () => {
      expect(MAX_BACKOFF_DELAY).toBeDefined();
      expect(typeof MAX_BACKOFF_DELAY).toBe('number');
    });

    it('should have correct MAX_BACKOFF_DELAY value', () => {
      expect(MAX_BACKOFF_DELAY).toBe(30000);
    });

    it('should define MAX_RECONNECT_ATTEMPTS constant', () => {
      expect(MAX_RECONNECT_ATTEMPTS).toBeDefined();
      expect(typeof MAX_RECONNECT_ATTEMPTS).toBe('number');
    });

    it('should have correct MAX_RECONNECT_ATTEMPTS value', () => {
      expect(MAX_RECONNECT_ATTEMPTS).toBe(0);
    });

    it('should have MAX_BACKOFF_DELAY greater than BASE_BACKOFF_DELAY', () => {
      expect(MAX_BACKOFF_DELAY).toBeGreaterThan(BASE_BACKOFF_DELAY);
    });

    it('should have reasonable BASE_BACKOFF_DELAY (between 100ms and 5s)', () => {
      expect(BASE_BACKOFF_DELAY).toBeGreaterThanOrEqual(100);
      expect(BASE_BACKOFF_DELAY).toBeLessThanOrEqual(5000);
    });

    it('should have reasonable MAX_BACKOFF_DELAY (between 10s and 60s)', () => {
      expect(MAX_BACKOFF_DELAY).toBeGreaterThanOrEqual(10000);
      expect(MAX_BACKOFF_DELAY).toBeLessThanOrEqual(60000);
    });
  });

  describe('Other Runtime Constants', () => {
    it('should define STALE_RESPONSE_THRESHOLD constant', () => {
      expect(STALE_RESPONSE_THRESHOLD).toBeDefined();
      expect(typeof STALE_RESPONSE_THRESHOLD).toBe('number');
    });

    it('should have correct STALE_RESPONSE_THRESHOLD value', () => {
      expect(STALE_RESPONSE_THRESHOLD).toBe(5 * 60 * 1000); // 5 minutes
    });

    it('should define TEXT_CHUNK_SIZE constant', () => {
      expect(TEXT_CHUNK_SIZE).toBeDefined();
      expect(typeof TEXT_CHUNK_SIZE).toBe('number');
    });

    it('should have correct TEXT_CHUNK_SIZE value', () => {
      expect(TEXT_CHUNK_SIZE).toBe(50);
    });

    it('should have reasonable STALE_RESPONSE_THRESHOLD (between 1 minute and 30 minutes)', () => {
      expect(STALE_RESPONSE_THRESHOLD).toBeGreaterThanOrEqual(60000);
      expect(STALE_RESPONSE_THRESHOLD).toBeLessThanOrEqual(30 * 60 * 1000);
    });

    it('should have reasonable TEXT_CHUNK_SIZE (between 10 and 1000 characters)', () => {
      expect(TEXT_CHUNK_SIZE).toBeGreaterThanOrEqual(10);
      expect(TEXT_CHUNK_SIZE).toBeLessThanOrEqual(1000);
    });
  });

  describe('All Constants Defined', () => {
    it('should export all required constants', () => {
      const requiredConstants = [
        'WS_URL',
        'HEARTBEAT_INTERVAL',
        'TIMEOUT_THRESHOLD',
        'BASE_BACKOFF_DELAY',
        'MAX_BACKOFF_DELAY',
        'MAX_RECONNECT_ATTEMPTS',
        'STALE_RESPONSE_THRESHOLD',
        'TEXT_CHUNK_SIZE',
      ];

      const exportedConstants = {
        WS_URL,
        HEARTBEAT_INTERVAL,
        TIMEOUT_THRESHOLD,
        BASE_BACKOFF_DELAY,
        MAX_BACKOFF_DELAY,
        MAX_RECONNECT_ATTEMPTS,
        STALE_RESPONSE_THRESHOLD,
        TEXT_CHUNK_SIZE,
      };

      requiredConstants.forEach((constantName) => {
        expect(exportedConstants).toHaveProperty(constantName);
        expect(exportedConstants[constantName as keyof typeof exportedConstants]).toBeDefined();
      });
    });
  });
});
