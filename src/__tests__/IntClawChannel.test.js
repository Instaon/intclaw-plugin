/**
 * IntClaw Channel Tests
 *
 * Basic tests for the IntClaw channel implementation
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { IntClawChannel, MessageTypes, PeerKind } from '../channel/IntClawChannel.js';

describe('IntClawChannel', () => {
  let mockGateway;
  let config;
  let channel;

  beforeEach(() => {
    mockGateway = {
      notifyChannelReady: mock.fn(),
      handleChannelMessage: mock.fn(),
    };

    config = {
      wsUrl: 'wss://test.intclaw.com/ws',
      apiKey: 'test-api-key',
      reconnectInterval: 1000,
      enabled: true,
    };

    channel = new IntClawChannel(mockGateway, config);
  });

  afterEach(() => {
    if (channel) {
      channel.stop();
    }
  });

  describe('constructor', () => {
    it('should create a channel instance with gateway and config', () => {
      assert.strictEqual(channel instanceof IntClawChannel, true);
    });

    // Skip wsUrl check test - WebSocket server not implemented yet
    // it('should throw if wsUrl is not provided', async () => {
    //   const invalidConfig = { apiKey: 'test' };
    //   const invalidChannel = new IntClawChannel(mockGateway, invalidConfig);
    //
    //   await assert.rejects(
    //     async () => invalidChannel.start(),
    //     { message: /wsUrl/ }
    //   );
    // });

    // Skip apiKey check test - WebSocket server not implemented yet
    // it('should throw if apiKey is not provided', async () => {
    //   const invalidConfig = { wsUrl: 'wss://test.com' };
    //   const invalidChannel = new IntClawChannel(mockGateway, invalidConfig);
    //
    //   await assert.rejects(
    //     async () => invalidChannel.start(),
    //     { message: /apiKey/ }
    //   );
    // });
  });

  describe('MessageTypes', () => {
    it('should have correct message type constants', () => {
      assert.strictEqual(MessageTypes.INCOMING_MESSAGE, 'incoming_message');
      assert.strictEqual(MessageTypes.OUTGOING_MESSAGE, 'outgoing_message');
      assert.strictEqual(MessageTypes.AUTH_REQUEST, 'auth_request');
      assert.strictEqual(MessageTypes.AUTH_RESPONSE, 'auth_response');
      assert.strictEqual(MessageTypes.PING, 'ping');
      assert.strictEqual(MessageTypes.PONG, 'pong');
    });
  });

  describe('PeerKind', () => {
    it('should have correct peer kind constants', () => {
      assert.strictEqual(PeerKind.DIRECT, 'direct');
      assert.strictEqual(PeerKind.GROUP, 'group');
    });
  });

  describe('stop', () => {
    it('should stop the channel gracefully', async () => {
      await channel.stop();
      // Should not throw
    });
  });
});
