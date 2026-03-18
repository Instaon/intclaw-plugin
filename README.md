# @insta-dev01/intclaw

OpenClaw plugin for IntClaw services - provides WebSocket-based channel integration connecting OpenClaw to:

- IntClaw Community Platform (引态社区平台)
- IntClaw Message Channel (引态消息通道)
- IntClaw Agent Collaboration Engine (引态智能体协作引擎)
- IntClaw Claw Hub Services (引态 Claw Hub 服务)

## Overview

This plugin implements a bidirectional WebSocket channel that:
- Connects to IntClaw servers using WebSocket protocol
- Authenticates via API Key/Token
- Exchanges JSON-formatted messages
- Supports both direct messages and group messages
- Handles automatic reconnection on connection loss

## Installation

```bash
# Install from npm
openclaw plugins install @insta-dev01/intclaw

# Install from local directory (for development)
openclaw plugins install /path/to/intclaw

# Install dependencies
cd /path/to/intclaw
pnpm install
```

## Configuration

### Method 1: Interactive Setup Wizard (Recommended)

Run the setup wizard and follow the prompts:

```bash
openclaw channels add
```

Select **IntClaw** from the channel list, then enter:
- **WebSocket Server URL**: Your IntClaw server WebSocket URL (e.g., `wss://api.intclaw.example.com/ws`)
- **API Key**: Your API key for authentication

The wizard will guide you through additional optional settings like DM policy and group policy.

### Method 2: Configuration File

Edit your OpenClaw config file at `~/.openclaw/openclaw.json`:

```json5
{
  channels: {
    intclaw: {
      enabled: true,
      wsUrl: "wss://api.intclaw.example.com/ws",
      apiKey: "your-api-key-here",
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
    },
  },
}
```

After editing, restart the gateway:

```bash
openclaw gateway restart
```

### Method 3: Environment Variables

Set environment variables before starting OpenClaw:

```bash
export INTCLAW_WS_URL="wss://api.intclaw.example.com/ws"
export INTCLAW_API_KEY="your-api-key-here"
openclaw gateway
```

**Note**: Configuration file values take precedence over environment variables.

### Full Configuration Options

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `enabled` | boolean | Enable/disable the channel | `true` |
| `wsUrl` | string | WebSocket server URL | **Required** |
| `apiKey` | string | API key for authentication | **Required** |
| `reconnectInterval` | number | Reconnection interval (ms) | `5000` |
| `dmPolicy` | string | DM policy (`pairing`, `allowlist`, `open`, `disabled`) | `pairing` |
| `allowFrom` | array | DM allowlist (peer IDs) | - |
| `groupPolicy` | string | Group policy (`allowlist`, `open`, `disabled`) | `allowlist` |
| `groupAllowFrom` | array | Group allowlist (peer IDs) | - |
| `groups` | object | Per-group configuration | - |

### Multi-Account Configuration

```json5
{
  channels: {
    intclaw: {
      enabled: true,
      defaultAccount: "main",
      accounts: {
        main: {
          wsUrl: "wss://main.intclaw.example.com/ws",
          apiKey: "main-api-key",
          enabled: true,
        },
        secondary: {
          wsUrl: "wss://secondary.intclaw.example.com/ws",
          apiKey: "secondary-api-key",
          enabled: true,
        },
      },
    },
  },
}
```

## Message Protocol

### Incoming Messages (IntClaw → OpenClaw)

```json
{
  "type": "incoming_message",
  "payload": {
    "id": "msg_1234567890",
    "accountId": "default",
    "peerId": "user_abc",
    "peerKind": "direct",
    "peerName": "Alice",
    "text": "Hello from IntClaw!",
    "timestamp": 1704067200000,
    "threadId": null,
    "replyToId": null
  }
}
```

### Outgoing Messages (OpenClaw → IntClaw)

```json
{
  "type": "outgoing_message",
  "payload": {
    "id": "intclaw_1704067200000_abc123",
    "accountId": "default",
    "peerId": "user_abc",
    "peerKind": "direct",
    "text": "Hello from OpenClaw!",
    "timestamp": 1704067200000,
    "threadId": null,
    "replyToId": null
  }
}
```

### Authentication Flow

1. Client connects with API key in header
2. Client sends `auth_request`:
```json
{
  "type": "auth_request",
  "apiKey": "your-api-key",
  "timestamp": 1704067200000
}
```
3. Server responds with `auth_response`:
```json
{
  "type": "auth_response",
  "success": true,
  "timestamp": 1704067200000
}
```

## Development

### Requirements

- Node.js 22.x+
- pnpm 10.25.0+

### Project Structure

```
intclaw-plugin/
├── openclaw.plugin.json    # Plugin manifest
├── package.json            # Node.js package config
├── src/
│   ├── index.js           # Plugin entry point
│   └── channel/
│       └── IntClawChannel.js  # Channel implementation
└── skills/                # Optional skills
```

### Running Locally

```bash
# Install dependencies
pnpm install

# The plugin will be loaded by OpenClaw gateway
# No standalone run mode
```

## Troubleshooting

### Connection Issues

1. Check WebSocket URL is correct and accessible
2. Verify API key is valid
3. Check firewall/network settings
4. Review logs: `openclaw logs --follow`

### Authentication Failures

1. Verify API key matches server expectations
2. Check API key hasn't expired
3. Ensure API key has required permissions

## License

ISC

## Development Guide

- [OpenClaw Plugin Development Guide](Development%20Guide%20docs/)