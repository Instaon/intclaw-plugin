/**
 * ---
 * status: active
 * birth_time: "2026-03-20T00:00:00Z"
 * original_intent: "Provide IntClaw bidirectional websocket channel and proxy messages to OpenClaw gateway using chunked streaming"
 * version_count: 3
 * ---
 */

import WebSocket from 'ws';
import { getRuntime } from '../index.js';

const wsConnections = new Map();

async function* streamFromGateway(opts) {
  const rt = getRuntime();
  const port = opts.gatewayPort || rt.gateway?.port || 18789;
  const gatewayUrl = `http://127.0.0.1:${port}/v1/chat/completions`;

  const headers = {
    'Content-Type': 'application/json',
    'X-OpenClaw-Agent-Id': opts.agentId || 'main',
  };

  const response = await fetch(gatewayUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'main',
      messages: [
        { role: 'user', content: opts.userContent }
      ],
      stream: true,
      user: opts.sessionKey,
    }),
  });

  if (!response.ok || !response.body) {
    const errText = response.body ? await response.text() : '(no body)';
    throw new Error(`Gateway error: ${response.status} - ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;

      const data = line.slice(6).trim();
      if (data === '[DONE]') return;

      try {
        const chunk = JSON.parse(data);
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch (_) {
      }
    }
  }
}

export const intclawChannel = {
  id: 'intclaw',

  meta: {
    docsLabel: 'intclaw',
    blurb: 'IntClaw hiring platform — once enabled, you can make yourself available for hire.',
    order: 80,
    aliases: ['intclaw'],
  },

  capabilities: {
    chatTypes: ['direct', 'group'],
    reactions: false,
    threads: false,
    media: false,
    nativeCommands: false,
    blockStreaming: false,
  },

  reload: { configPrefixes: ['channels.intclaw'] },

  configSchema: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean', default: true },
        appKey: { type: 'string', description: 'IntClaw App Key' },
        appSecret: { type: 'string', description: 'IntClaw App Secret' },
        ackText: { type: 'string', default: '🫡 任务已接收，处理中...', description: 'Ack text when asyncMode is enabled' },
        sessionTimeout: { type: 'number', default: 1800000, description: 'Session timeout in ms (default 30min)' },
        systemPrompt: { type: 'string', default: '', description: 'Custom system prompt' }
      },
      required: ['appKey', 'appSecret'],
    },
    uiHints: {
      enabled: { label: 'Make yourself available for hire' },
      appKey: { label: 'App Key', sensitive: false },
      appSecret: { label: 'App Secret', sensitive: true },
      ackText: { label: 'Ack Text' },
      sessionTimeout: { label: 'Session Timeout' },
      systemPrompt: { label: 'System Prompt' }
    },
  },

  config: {
    listAccountIds(cfg) {
      const config = cfg?.channels?.['intclaw'] || {};
      return config.appKey ? ['__default__'] : [];
    },

    resolveAccount(cfg, accountId) {
      const config = cfg?.channels?.['intclaw'] || {};
      return {
        accountId: accountId || '__default__',
        config,
        enabled: config.enabled !== false,
      };
    },

    defaultAccountId: () => '__default__',

    isConfigured(account) {
      return !!(account.config?.appKey && account.config?.appSecret);
    },

    describeAccount(account) {
      return {
        accountId: account.accountId,
        name: 'IntClaw Channel',
        enabled: account.enabled,
        configured: !!account.config?.appKey,
      };
    },
  },

  security: {
    resolveDmPolicy: ({ account }) => ({
      policy: account.config?.dmPolicy || 'open',
      allowFrom: account.config?.allowFrom || [],
      policyPath: 'channels.intclaw.dmPolicy',
      allowFromPath: 'channels.intclaw.allowFrom',
      approveHint: '使用 /allow intclaw:<userId> 批准',
      normalizeEntry: (raw) => String(raw).replace(/^(intclaw):/i, ''),
    }),
  },

  groups: {
    resolveRequireMention: ({ cfg }) => {
      const config = cfg?.channels?.['intclaw'] || {};
      return config.groupPolicy !== 'open';
    },
  },

  messaging: {
    normalizeTarget: (raw) => raw,
    targetResolver: {
      looksLikeId: () => true,
    },
  },

  outbound: {
    deliveryMode: 'direct',
    textChunkLimit: 4000,

    async sendText(ctx) {
      const { cfg, to, text, accountId, log } = ctx;
      const actId = accountId || '__default__';
      const wsConn = wsConnections.get(actId);

      if (!wsConn || wsConn.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not connected for account: ' + actId);
      }

      let peerId = String(to);
      let peerKind = 'direct';

      if (peerId.startsWith('user:')) {
        peerId = peerId.slice(5);
        peerKind = 'direct';
      } else if (peerId.startsWith('group:')) {
        peerId = peerId.slice(6);
        peerKind = 'group';
      }

      const outMsg = {
        type: 'outgoing_message',
        payload: {
          id: `intclaw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          account_id: actId,
          peer_id: peerId,
          peer_kind: peerKind,
          text: text,
          timestamp: Date.now(),
          is_chunk: false,
          is_done: true,
        },
      };

      wsConn.send(JSON.stringify(outMsg));
      return {
        channel: 'intclaw',
        messageId: outMsg.payload.id,
      };
    },
  },

  gateway: {
    async startAccount(ctx) {
      const { account, abortSignal, cfg } = ctx;
      const appKey = account.config?.appKey;
      const appSecret = account.config?.appSecret;

      if (!appKey || !appSecret) {
        throw new Error('appKey and appSecret are required');
      }

      const wsUrl = 'wss://claw-dev.int-os.com/user-ws/';
      let wsConn = null;
      let stopped = false;

      const connect = () => {
        if (stopped) return;

        wsConn = new WebSocket(wsUrl, {
          headers: {
            'X-App-Key': appKey,
            'X-App-Secret': appSecret,
          },
        });

        wsConnections.set(account.accountId, wsConn);

        wsConn.on('open', () => {
          const authPayload = {
            type: 'auth_request',
            app_key: appKey,
            timestamp: Date.now(),
          };
          wsConn.send(JSON.stringify(authPayload));
        });

        wsConn.on('message', async (data) => {
          try {
            const msg = JSON.parse(data.toString());

            if (msg.type === 'auth_response') {
              if (msg.success && ctx.channelReady) {
                ctx.channelReady();
              }
            } else if (msg.type === 'incoming_message') {
              await processIncomingMessage(msg.payload, wsConn, account, cfg, ctx);
            } else if (msg.type === 'ping') {
              wsConn.send(JSON.stringify({ type: 'pong' }));
            }
          } catch (err) {
            console.error(JSON.stringify({ error: 'failed_to_handle_msg', reason: err.message }));
          }
        });

        wsConn.on('error', (err) => {
          console.error(JSON.stringify({ error: 'ws_error', reason: err.message }));
        });

        wsConn.on('close', (code, reason) => {
          console.log(JSON.stringify({ event: 'ws_closed', code, reason: reason?.toString() }));
          wsConnections.delete(account.accountId);
          if (!stopped) {
            setTimeout(connect, 5000);
          }
        });
      };

      const processIncomingMessage = async (payload, wsTarget, accountInfo, cfg, ctx) => {
        let peerIdOut = String(payload.peerId || '');
        if (payload.peerKind === 'group' && !peerIdOut.startsWith('group:')) {
            peerIdOut = `group:${peerIdOut}`;
        } else if (payload.peerKind === 'direct' && !peerIdOut.startsWith('user:')) {
            peerIdOut = `user:${peerIdOut}`;
        }
        
        const sessionContext = {
          channel: 'intclaw',
          accountId: accountInfo.accountId,
          chatType: payload.peerKind || 'direct',
          peerId: peerIdOut,
        };
        const sessionKey = JSON.stringify(sessionContext);
        const userContent = payload.text;

        try {
          const replyId = `intclaw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          for await (const chunk of streamFromGateway({
            userContent,
            sessionKey,
            gatewayPort: cfg?.gateway?.port,
            agentId: 'main',
          })) {
            sendStreamChunk(wsTarget, payload, accountInfo, chunk, false, replyId);
          }
          sendStreamChunk(wsTarget, payload, accountInfo, '', true, replyId);
        } catch (err) {
          console.error(JSON.stringify({ error: 'gateway_stream_failed', reason: err.message }));
        }
      };

      const sendStreamChunk = (wsTarget, incomingPayload, accountInfo, chunkText, isDone, id) => {
        if (wsTarget.readyState !== WebSocket.OPEN) return;

        const outMsg = {
          type: 'outgoing_message',
          payload: {
            id,
            account_id: accountInfo.accountId,
            peer_id: incomingPayload.peerId,
            peer_kind: incomingPayload.peerKind,
            text: chunkText,
            reply_to_id: incomingPayload.id,
            timestamp: Date.now(),
            is_chunk: true,
            is_done: isDone,
          },
        };

        wsTarget.send(JSON.stringify(outMsg));
      };

      connect();

      return new Promise((resolve) => {
        const doStop = () => {
          if (stopped) return;
          stopped = true;
          wsConnections.delete(account.accountId);
          if (wsConn) {
            wsConn.close();
          }
        };

        if (abortSignal) {
          abortSignal.addEventListener('abort', () => {
            doStop();
            resolve({
              stop: doStop,
              isHealthy: () => !stopped,
            });
          });
        }
      });
    },
  },

  status: {
    defaultRuntime: {
      accountId: '__default__',
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },

    async probe({ cfg }) {
      const config = cfg?.channels?.['intclaw'] || {};
      const ok = !!(config.appKey && config.appSecret);
      return { ok };
    },

    buildChannelSummary({ snapshot }) {
      return {
        configured: snapshot?.configured ?? true,
        running: snapshot?.running ?? false,
        lastStartAt: snapshot?.lastStartAt ?? null,
        lastStopAt: snapshot?.lastStopAt ?? null,
        lastError: snapshot?.lastError ?? null,
      };
    },
  },
};