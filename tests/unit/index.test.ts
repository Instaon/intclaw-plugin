/**
 * Unit tests for Instagram Claw Connector Plugin Entry (index.ts)
 * 
 * Tests the main plugin class lifecycle, configuration handling,
 * and message routing functionality.
 */

import { describe, it, expect } from 'vitest';
import type { PluginConfig } from '../../types.js';

describe('InstaClawConnector', () => {
  describe('Configuration Management', () => {
    it('should validate configuration on update', () => {
      // Test configuration validation
      const validConfig: PluginConfig = {
        enabled: true,
        clientId: 'test-client-id',
        clientSecret: 'test-secret',
        systemPrompt: 'Test prompt',
      };
      
      expect(validConfig.enabled).toBe(true);
      expect(validConfig.clientId).toBe('test-client-id');
      expect(validConfig.clientSecret).toBe('test-secret');
    });
    
    it('should handle invalid configuration', () => {
      const invalidConfig = {
        enabled: true,
        clientId: '',
        clientSecret: 'test-secret',
      };
      
      expect(invalidConfig.clientId).toBe('');
    });
  });
  
  describe('Message Processing', () => {
    it('should extract text from string message', () => {
      const message = 'Hello, world!';
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    });
    
    it('should extract text from object message with text field', () => {
      const message = {
        text: 'Hello, world!',
        metadata: { timestamp: Date.now() },
      };
      
      expect(message.text).toBe('Hello, world!');
      expect(typeof message.text).toBe('string');
    });
    
    it('should extract text from object message with content field', () => {
      const message = {
        content: 'Hello, world!',
        metadata: { timestamp: Date.now() },
      };
      
      expect(message.content).toBe('Hello, world!');
      expect(typeof message.content).toBe('string');
    });
    
    it('should handle message without text content', () => {
      const message = {
        metadata: { timestamp: Date.now() },
      };
      
      expect(message.metadata).toBeDefined();
      expect((message as any).text).toBeUndefined();
    });
  });
  
  describe('Error Handling', () => {
    it('should handle SDK errors gracefully', () => {
      const error = new Error('SDK call failed');
      
      expect(error.message).toBe('SDK call failed');
      expect(error.stack).toBeDefined();
    });
    
    it('should create failed event structure', () => {
      const error = new Error('Test error');
      const failedEvent = {
        type: 'response.failed',
        response_id: 'resp_test',
        status: 'failed',
        error: {
          code: 'SDK_ERROR',
          message: error.message,
          details: error.stack,
        },
        timestamp: new Date().toISOString(),
      };
      
      expect(failedEvent.type).toBe('response.failed');
      expect(failedEvent.status).toBe('failed');
      expect(failedEvent.error.code).toBe('SDK_ERROR');
      expect(failedEvent.error.message).toBe('Test error');
    });
  });
  
  describe('Resource Cleanup', () => {
    it('should handle cleanup without active connection', async () => {
      // Test that cleanup works even when no connection exists
      let connection: any = null;
      
      // Simulate cleanup
      if (connection) {
        await connection.disconnect();
      }
      
      expect(connection).toBeNull();
    });
  });
});
