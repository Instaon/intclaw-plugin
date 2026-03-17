/**
 * IntClaw Channel Implementation
 *
 * Handles WebSocket connection and message routing for IntClaw services.
 */

const CHANNEL_ID = 'intclaw';
const DEFAULT_RECONNECT_INTERVAL = 5000;

/**
 * IntClaw message types
 */
export const MessageTypes = {
  // Incoming messages from IntClaw server
  INCOMING_MESSAGE: 'incoming_message',
  // Outgoing messages to IntClaw server
  OUTGOING_MESSAGE: 'outgoing_message',
  // Connection status
  CONNECTION_STATUS: 'connection_status',
  // Authentication
  AUTH_REQUEST: 'auth_request',
  AUTH_RESPONSE: 'auth_response',
  // Heartbeat
  PING: 'ping',
  PONG: 'pong',
};

/**
 * IntClaw peer kinds
 */
export const PeerKind = {
  DIRECT: 'direct',
  GROUP: 'group',
};

export class IntClawChannel {
  #gateway;
  #config;
  #ws = null;
  #reconnectTimer = null;
  #isShuttingDown = false;
  #isAuthenticated = false;

  constructor(gateway, config) {
    this.#gateway = gateway;
    this.#config = config;
  }

  /**
   * Start the channel
   */
  async start() {
    this.#log('info', 'Starting IntClaw channel...');

    if (!this.#config.wsUrl) {
      throw new Error('IntClaw channel requires wsUrl in configuration');
    }

    if (!this.#config.apiKey) {
      throw new Error('IntClaw channel requires apiKey in configuration');
    }

    await this.#connect();
  }

  /**
   * Stop the channel
   */
  async stop() {
    this.#log('info', 'Stopping IntClaw channel...');
    this.#isShuttingDown = true;

    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }

    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }

    this.#log('info', 'IntClaw channel stopped');
  }

  /**
   * Connect to IntClaw WebSocket server
   */
  async #connect() {
    if (this.#isShuttingDown) {
      return;
    }

    try {
      this.#log('info', `Connecting to IntClaw server: ${this.#config.wsUrl}`);

      // Import ws module dynamically
      const WebSocket = (await import('ws')).default;

      this.#ws = new WebSocket(this.#config.wsUrl, {
        headers: {
          'X-API-Key': this.#config.apiKey,
        },
      });

      this.#ws.on('open', () => this.#onOpen());
      this.#ws.on('message', (data) => this.#onMessage(data));
      this.#ws.on('error', (error) => this.#onError(error));
      this.#ws.on('close', (code, reason) => this.#onClose(code, reason));

    } catch (error) {
      this.#log('error', `Connection failed: ${error.message}`);
      this.#scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket open event
   */
  #onOpen() {
    this.#log('info', 'Connected to IntClaw server');

    // Send authentication request
    this.#send({
      type: MessageTypes.AUTH_REQUEST,
      apiKey: this.#config.apiKey,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle WebSocket message event
   */
  async #onMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      this.#log('debug', `Received message type: ${message.type}`);

      switch (message.type) {
        case MessageTypes.AUTH_RESPONSE:
          await this.#handleAuthResponse(message);
          break;

        case MessageTypes.INCOMING_MESSAGE:
          await this.#handleIncomingMessage(message);
          break;

        case MessageTypes.PING:
          this.#send({ type: MessageTypes.PONG });
          break;

        case MessageTypes.PONG:
          // Pong received, connection is alive
          break;

        default:
          this.#log('warn', `Unknown message type: ${message.type}`);
      }
    } catch (error) {
      this.#log('error', `Failed to handle message: ${error.message}`);
    }
  }

  /**
   * Handle authentication response
   */
  async #handleAuthResponse(message) {
    if (message.success) {
      this.#isAuthenticated = true;
      this.#log('info', 'Authenticated with IntClaw server');

      // Notify gateway that channel is ready
      if (this.#gateway?.notifyChannelReady) {
        await this.#gateway.notifyChannelReady(CHANNEL_ID);
      }
    } else {
      this.#log('error', `Authentication failed: ${message.error || 'Unknown error'}`);
      this.#ws.close();
    }
  }

  /**
   * Handle incoming message from IntClaw server
   */
  async #handleIncomingMessage(message) {
    if (!this.#isAuthenticated) {
      this.#log('warn', 'Ignoring message: not authenticated');
      return;
    }

    const { payload } = message;

    // Normalize message for OpenClaw gateway
    const normalizedMessage = {
      channel: CHANNEL_ID,
      accountId: payload.accountId || 'default',
      peer: {
        kind: payload.peerKind || PeerKind.DIRECT,
        id: payload.peerId,
        name: payload.peerName,
      },
      text: payload.text,
      timestamp: payload.timestamp || Date.now(),
      id: payload.id,
      threadId: payload.threadId,
      replyToId: payload.replyToId,
    };

    // Send to gateway for processing
    if (this.#gateway?.handleChannelMessage) {
      await this.#gateway.handleChannelMessage(normalizedMessage);
    } else {
      this.#log('warn', 'Gateway does not support handleChannelMessage');
    }
  }

  /**
   * Handle WebSocket error event
   */
  #onError(error) {
    this.#log('error', `WebSocket error: ${error.message}`);
  }

  /**
   * Handle WebSocket close event
   */
  #onClose(code, reason) {
    this.#log('info', `Connection closed: ${code} - ${reason || 'No reason'}`);
    this.#isAuthenticated = false;

    if (!this.#isShuttingDown) {
      this.#scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection attempt
   */
  #scheduleReconnect() {
    const interval = this.#config.reconnectInterval || DEFAULT_RECONNECT_INTERVAL;

    this.#log('info', `Reconnecting in ${interval}ms...`);

    this.#reconnectTimer = setTimeout(() => {
      this.#connect();
    }, interval);
  }

  /**
   * Send message to IntClaw server
   */
  #send(message) {
    if (this.#ws && this.#ws.readyState === 1 /* OPEN */) {
      this.#ws.send(JSON.stringify(message));
    } else {
      this.#log('warn', 'Cannot send message: WebSocket not connected');
    }
  }

  /**
   * Send message action
   */
  async send(message) {
    const payload = {
      type: MessageTypes.OUTGOING_MESSAGE,
      payload: {
        id: message.id || this.#generateMessageId(),
        accountId: message.accountId || 'default',
        peerId: message.peer.id,
        peerKind: message.peer.kind,
        text: message.text,
        threadId: message.threadId,
        replyToId: message.replyToId,
        timestamp: Date.now(),
      },
    };

    this.#send(payload);
  }

  /**
   * Generate unique message ID
   */
  #generateMessageId() {
    return `intclaw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Log message
   */
  #log(level, message) {
    const logMessage = `[IntClaw Channel] ${message}`;

    switch (level) {
      case 'error':
        console.error(logMessage);
        break;
      case 'warn':
        console.warn(logMessage);
        break;
      case 'debug':
        // Only log debug in development
        if (process.env.NODE_ENV === 'development') {
          console.log(logMessage);
        }
        break;
      default:
        console.log(logMessage);
    }
  }
}
