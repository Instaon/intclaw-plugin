# Instagram Claw Connector

A lightweight OpenClaw channel plugin for WebSocket-based bidirectional messaging using the Open Responses protocol.

## Overview

Instagram Claw Connector enables real-time communication between OpenClaw and a remote WebSocket server at `wss://claw-dev.int-os.com/user-ws/`. The plugin implements the Open Responses specification for streaming text messages with full support for connection management, heartbeat mechanisms, and automatic reconnection.

## Features

- ✅ WebSocket connection to remote server with authentication
- ✅ Open Responses protocol implementation
- ✅ Bidirectional message streaming
- ✅ Automatic reconnection with exponential backoff
- ✅ Heartbeat mechanism for connection health monitoring
- ✅ Comprehensive debug logging
- ✅ TypeScript with strict type safety
- ✅ Property-based testing with fast-check

## Requirements

- Node.js >= 18.0.0
- OpenClaw SDK

## Installation

```bash
# Install dependencies
pnpm install

# Type check
pnpm run type-check

# Run tests
pnpm test

# Run tests with coverage
pnpm run test:coverage
```

## Configuration

Configure the plugin through OpenClaw's configuration interface:

```json
{
  "enabled": true,
  "clientId": "your-app-key",
  "clientSecret": "your-app-secret",
  "systemPrompt": "Optional system prompt",
  "debug": false
}
```

### Configuration Fields

- **enabled** (boolean, default: true): Enable or disable the plugin
- **clientId** (string, required): App Key for authentication (sent as `x-app-key` header)
- **clientSecret** (string, required, sensitive): App Secret for authentication (sent as `x-app-secret` header)
- **systemPrompt** (string, optional): System prompt for the AI assistant
- **debug** (boolean, default: false): Enable detailed debug logging

### Environment Variables

You can override configuration through environment variables:

- `INSTACLAW_WS_URL`: WebSocket server URL (default: `wss://claw-dev.int-os.com/user-ws/`)
- `INSTACLAW_HEARTBEAT_INTERVAL`: Heartbeat interval in milliseconds (default: 30000)
- `INSTACLAW_TIMEOUT_THRESHOLD`: Connection timeout threshold in milliseconds (default: 90000)

## Architecture

The plugin follows a modular architecture:

```
index.ts          - Plugin entry point and lifecycle management
channel.ts        - ChannelPlugin definition and outbound methods
connection.ts     - WebSocket connection manager
protocol.ts       - Open Responses protocol handler
config.ts         - Configuration management
logger.ts         - Debug logging system
types.ts          - TypeScript type definitions
```

### Key Components

1. **Plugin Entry (index.ts)**: Manages plugin lifecycle and coordinates components
2. **Channel Plugin (channel.ts)**: Defines plugin metadata, capabilities, and methods
3. **Connection Manager (connection.ts)**: Handles WebSocket connections, heartbeat, and reconnection
4. **Protocol Handler (protocol.ts)**: Implements Open Responses event parsing and generation
5. **Debug Logger (logger.ts)**: Provides structured logging with multiple levels
6. **Configuration (config.ts)**: Manages runtime configuration
7. **Type Definitions (types.ts)**: Complete TypeScript type system

## Usage

### Development Mode

```bash
# Start OpenClaw with the plugin
openclaw start
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run unit tests only
pnpm run test:unit

# Run property tests only
pnpm run test:property

# Run tests in watch mode
pnpm run test:watch

# Generate coverage report
pnpm run test:coverage
```

## Open Responses Protocol

The plugin implements the Open Responses specification for WebSocket communication:

### Supported Event Types

- `response.in_progress`: Response generation started
- `response.output_item.added`: New output item added
- `response.output_text.delta`: Incremental text update
- `response.content_part.done`: Content part completed
- `response.completed`: Response successfully completed
- `response.failed`: Response failed with error

### Message Flow

**Outbound (OpenClaw → Server)**:
1. Generate unique `response_id` and `item_id`
2. Send `response.in_progress` event
3. Send `response.output_item.added` event
4. Send one or more `response.output_text.delta` events
5. Send `response.content_part.done` event
6. Send `response.completed` event

**Inbound (Server → OpenClaw)**:
1. Parse WebSocket Envelope
2. Extract event from `data` field
3. Update Response state machine
4. Accumulate text deltas
5. Forward completed messages to OpenClaw

### WebSocket Envelope Format

All messages are wrapped in a WebSocket Envelope:

```json
{
  "type": "message",
  "headers": {
    "messageId": "msg_1234567890_abc123",
    "timestamp": 1234567890000
  },
  "data": "{\"type\":\"response.in_progress\",\"event_id\":\"evt_...\",\"response_id\":\"resp_...\"}"
}
```

## Connection Management

### Heartbeat Mechanism

- Sends ping packets every 30 seconds (configurable via `INSTACLAW_HEARTBEAT_INTERVAL`)
- Monitors pong responses
- Triggers reconnection if no pong received within 90 seconds (3x heartbeat interval)
- Logs heartbeat activity in debug mode

### Reconnection Strategy

- Automatic reconnection on disconnect
- Exponential backoff: `min(1000 * 2^attempt, 30000) + random(0, 1000)` ms
- Maximum delay capped at 30 seconds
- Random jitter to prevent thundering herd
- Reconnection counter resets on successful connection
- Infinite reconnection attempts (configurable)

### Connection States

- `disconnected`: No active connection
- `connecting`: Connection attempt in progress
- `connected`: Active connection established
- `reconnecting`: Attempting to reconnect after disconnect

## Debug Logging

Enable debug logging through the configuration:

```json
{
  "debug": true
}
```

### Log Levels

- **info**: Key operations (connection established, messages sent/received)
- **debug**: Detailed information (event parsing, state changes) - only when debug=true
- **warn**: Warnings (reconnection attempts, configuration issues)
- **error**: Errors (connection failures, parsing errors) with stack traces

### Log Format

```
[2024-01-01T00:00:00.000Z] [INFO] [InstaClawConnector] Connection established
[2024-01-01T00:00:01.000Z] [DEBUG] [InstaClawConnector] Parsed event: response.in_progress
[2024-01-01T00:00:02.000Z] [ERROR] [InstaClawConnector] Connection failed: ECONNREFUSED
```

## Error Handling

The plugin implements comprehensive error handling:

- **Connection Errors**: Automatic reconnection with exponential backoff
- **Message Parsing Errors**: Log error and skip message, continue processing
- **Protocol Violations**: Log warning and ignore invalid events
- **SDK Errors**: Send `response.failed` event to server
- **Configuration Errors**: Throw descriptive error at startup

## Testing

The project uses a dual testing approach:

### Unit Tests

Test specific examples, edge cases, and integration points:

```typescript
// tests/unit/connection.test.ts
it('should connect with valid credentials', async () => {
  // Test implementation
});
```

### Property-Based Tests

Verify universal properties across randomized inputs:

```typescript
// tests/protocol.test.ts
it('Property 1: Message Format Round-Trip', () => {
  fc.assert(
    fc.property(eventGenerator(), (event) => {
      const envelope = createEnvelope(event);
      const parsed = parseEnvelope(envelope);
      expect(parsed.type).toBe(event.type);
    })
  );
});
```

### Test Results

```
✓ tests/protocol.test.ts (23 tests)
✓ tests/unit/config.test.ts (26 tests)
✓ tests/unit/connection.test.ts (6 tests)
✓ tests/unit/index.test.ts (9 tests)

Test Files: 4 passed (4)
Tests: 64 passed (64)
```

### Coverage Goals

- Line Coverage: ≥ 80%
- Function Coverage: ≥ 85%
- Branch Coverage: ≥ 75%
- Property Coverage: 100%

## Troubleshooting

### Connection Issues

1. **Cannot connect to WebSocket server**
   - Verify `clientId` and `clientSecret` are correct
   - Check network connectivity
   - Ensure `enabled` is set to `true`
   - Review error logs for details

2. **Frequent disconnections**
   - Check network stability
   - Review heartbeat logs
   - Verify server is responding to ping packets
   - Check firewall settings

3. **Messages not being received**
   - Enable debug logging
   - Check message parsing logs
   - Verify Open Responses event format
   - Check server is sending correct envelope format

4. **Messages not being sent**
   - Verify WebSocket connection is established
   - Check connection state in logs
   - Ensure outbound.sendText is being called correctly
   - Review error logs for send failures

### Debug Mode

Enable debug logging to see detailed information:

```json
{
  "debug": true
}
```

This will output:
- All WebSocket events
- Message parsing details
- State machine transitions
- Heartbeat activity
- Reconnection attempts
- Event sequence generation

### Common Error Messages

**"InstaClaw connector is not enabled in configuration"**
- Set `enabled: true` in configuration

**"Missing required configuration: clientId must be provided and non-empty"**
- Provide valid `clientId` in configuration

**"Missing required configuration: clientSecret must be provided and non-empty"**
- Provide valid `clientSecret` in configuration

**"WebSocket is not connected"**
- Wait for connection to establish
- Check connection logs
- Verify server is accessible

**"Cannot send empty message"**
- Ensure message text is not empty or whitespace-only

## Performance Considerations

### Connection Performance

- Heartbeat interval: 30 seconds (configurable)
- Timeout threshold: 90 seconds (3x heartbeat)
- Reconnection delay: Exponential backoff up to 30 seconds
- Message chunk size: 50 characters (for streaming simulation)

### Memory Management

- Response states are cleaned up on completion or failure
- Old connections are properly closed before reconnection
- Event listeners are removed on disconnect
- No memory leaks in long-running connections

### Network Optimization

- Text chunking for streaming effect
- Efficient JSON serialization
- Minimal overhead in envelope format
- Connection reuse for multiple messages

## Security Considerations

### Credentials Management

- `clientSecret` marked as sensitive in UI
- Credentials not logged in production
- Support for environment variable configuration
- Secure WebSocket (WSS) protocol

### Connection Security

- WSS (WebSocket Secure) protocol
- Authentication headers on every connection
- Connection timeout protection
- Automatic cleanup on abort

### Data Validation

- All inbound messages validated
- Malformed messages logged and skipped
- Type safety through TypeScript
- No code injection vulnerabilities

## MVP Scope and Limitations

This is an MVP (Minimum Viable Product) implementation focused on core functionality:

### Included Features

✅ Text message bidirectional streaming  
✅ Direct chat support  
✅ WebSocket connection management  
✅ Heartbeat and reconnection  
✅ Open Responses protocol  
✅ Debug logging  
✅ Error handling  

### Not Included (Future Enhancements)

❌ Media support (images, files, audio, video)  
❌ Group chat functionality  
❌ Multi-account support  
❌ User directory/contact list  
❌ Security policies and access control  
❌ User pairing/authentication flow  
❌ Message editing and deletion  
❌ Emoji reactions  
❌ Message threading  

## Requirements Verification

All 20 requirements from the specification have been implemented and verified. See `REQUIREMENTS-VERIFICATION.md` for detailed verification report.

### Key Requirements Met

- ✅ Plugin registration through `register(api)` function
- ✅ ChannelPlugin metadata and capabilities
- ✅ Configuration schema with UI hints
- ✅ Gateway lifecycle management
- ✅ WebSocket connection with authentication
- ✅ Open Responses protocol implementation
- ✅ Heartbeat mechanism
- ✅ Exponential backoff reconnection
- ✅ Comprehensive error handling
- ✅ TypeScript type safety

## License

MIT

## Contributing

Contributions are welcome! Please ensure:

1. All tests pass: `pnpm test`
2. Type checking passes: `pnpm run type-check`
3. Code follows TypeScript strict mode
4. New features include both unit and property tests
5. Documentation is updated
6. Commit messages are clear and descriptive

### Development Workflow

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and type checking
5. Submit a pull request

## Support

For issues and questions, please open an issue on the GitHub repository.

## Acknowledgments

This plugin is based on the OpenClaw Channel Plugin architecture and follows the Open Responses protocol specification. Architecture inspired by the dingtalk-openclaw-connector implementation.

## Version History

### 1.0.0 (2024-03-30)
- Initial MVP release
- WebSocket connection management
- Open Responses protocol implementation
- Heartbeat and reconnection mechanisms
- Comprehensive testing suite
- Full documentation
