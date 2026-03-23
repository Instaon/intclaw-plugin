/**
 * ---
 * status: active
 * birth_time: "2026-03-20T00:00:00Z"
 * original_intent: "Provide IntClaw bidirectional websocket channel and proxy messages to OpenClaw gateway using chunked streaming"
 * version_count: 5
 * ---
 */

import WebSocket from 'ws';
import { getRuntime } from '../index.js';

const wsConnections = new Map();

async function* streamFromGateway(options) {
  const { userContent, sessionKey, gatewayAuth, gatewayBaseUrl, memoryUser, gatewayPort, log, systemPrompts = [], agentId } = options;
  const rt = getRuntime();
  const port = gatewayPort || rt.gateway?.port || 18789;
  const gatewayUrl = gatewayBaseUrl
    ? `${gatewayBaseUrl}/v1/chat/completions`
    : `http://127.0.0.1:${port}/v1/chat/completions`;

  const messages = [];
  for (const prompt of systemPrompts) {
    if (prompt) messages.push({ role: 'system', content: prompt });
  }
  messages.push({ role: 'user', content: userContent });

  const headers = {
    'Content-Type': 'application/json',
    'X-OpenClaw-Agent-Id': agentId || 'main',
  };

  if (gatewayAuth) {
    headers['Authorization'] = `Bearer ${gatewayAuth}`;
  }

  if (memoryUser) {
    headers['X-OpenClaw-Memory-User'] = Buffer.from(memoryUser, 'utf-8').toString('base64');
  }

  log?.info?.(`[IntClaw][Gateway] POST ${gatewayUrl}, session=${sessionKey}, agentId=${agentId || 'main'}, gatewayAuth=${gatewayAuth}`);

  const originalRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  
  try {
    if (gatewayUrl.startsWith('https://')) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      log?.debug?.(`[IntClaw][Gateway] TLS 模式：已临时禁用证书验证`);
    }

    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'main',
        messages,
        stream: true,
        user: sessionKey,
      }),
    });

    if (!response.ok || !response.body) {
      const errText = response.body ? await response.text() : '(no body)';
      log?.error?.(`[IntClaw][Gateway] 错误响应：${errText}`);
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
  } finally {
    if (gatewayUrl.startsWith('https://')) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalRejectUnauthorized;
      log?.debug?.(`[IntClaw][Gateway] TLS 模式：已恢复证书验证设置`);
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
        systemPrompt: { type: 'string', default: '', description: 'Custom system prompt' },
        gatewayToken: { type: 'string', default: '', description: 'Gateway auth token' },
        gatewayBaseUrl: { type: 'string', default: '', description: 'Custom Gateway URL' }
      },
      required: ['appKey', 'appSecret'],
    },
    uiHints: {
      enabled: { label: 'Make yourself available for hire' },
      appKey: { label: 'App Key', sensitive: false },
      appSecret: { label: 'App Secret', sensitive: true },
      ackText: { label: 'Ack Text' },
      sessionTimeout: { label: 'Session Timeout' },
      systemPrompt: { label: 'System Prompt' },
      gatewayToken: { label: 'Gateway Token', sensitive: true },
      gatewayBaseUrl: { label: 'Gateway Base URL' }
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

    sendText(ctx) {
      const { cfg, to, text, accountId, log } = ctx;
      const actId = accountId || '__default__';
      const wsConn = wsConnections.get(actId);

      if (!wsConn || wsConn.readyState !== WebSocket.OPEN) {
        log?.error?.(`[IntClaw] WebSocket not connected for account: ${actId}`);
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

      log?.info?.(`[IntClaw] Sending message to ${peerKind}:${peerId}, text="${text.slice(0, 50)}..."`);

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
      const { account, abortSignal, cfg, log } = ctx;
      log?.info("startAccount")
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

        log?.info?.(`[IntClaw] Connecting to WebSocket: ${wsUrl}`);
        wsConn = new WebSocket(wsUrl, {
          headers: {
            'X-App-Key': appKey,
            'X-App-Secret': appSecret,
          },
        });

        wsConnections.set(account.accountId, wsConn);

        wsConn.on('open', () => {
          log?.info?.(`[IntClaw] WebSocket connected for account: ${account.accountId}`);
          const authPayload = {
            type: 'auth_request',
            app_key: appKey,
            timestamp: Date.now(),
          };
          log?.info?.(`[IntClaw] Sending auth request for appKey: ${appKey}`);
          wsConn.send(JSON.stringify(authPayload));
        });

        wsConn.on('message', async (data) => {
          try {
            // const msg = JSON.parse(data.toString());
            const msg = {
              type: 'incoming_message',
              payload: {
                peerKind: 'direct',
                peerId: "1",
                text: data.toString()
              }
            }
            if (msg.type === 'auth_response') {
              log?.info?.(`[IntClaw] Auth response: success=${msg.success}`);
              if (msg.success && ctx.channelReady) {
                ctx.channelReady();
              }
            } else if (msg.type === 'incoming_message') {
              log?.info?.(`[IntClaw] Received incoming message from ${msg.payload.peerId} (${msg.payload.peerKind}): ${msg.payload.text?.slice(0, 50)}...`);
              await processIncomingMessage(msg.payload, wsConn, account, cfg, ctx);
            } else if (msg.type === 'ping') {
              wsConn.send(JSON.stringify({ type: 'pong' }));
            }
          } catch (err) {
            log?.error?.(`[IntClaw] Failed to handle incoming message: ${err.message}`);
          }
        });

        wsConn.on('error', (err) => {
          log?.error?.(`[IntClaw] WebSocket error: ${err.message}`);
        });

        wsConn.on('close', (code, reason) => {
          log?.warn?.(`[IntClaw] WebSocket closed: code=${code}, reason=${reason?.toString() || 'none'}`);
          wsConnections.delete(account.accountId);
          if (!stopped) {
            log?.info?.(`[IntClaw] Reconnecting in 5 seconds...`);
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

        log?.info?.(`[IntClaw] Starting gateway stream for peerId=${peerIdOut}`);

        const systemPrompt = accountInfo.config?.systemPrompt;
        const systemPrompts = systemPrompt ? [systemPrompt] : [];
        const gatewayAuth = accountInfo.config?.gatewayToken || accountInfo.config?.gatewayPassword || '';
        const gatewayBaseUrl = accountInfo.config?.gatewayBaseUrl || '';

        try {
          const replyId = `intclaw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          for await (const chunk of streamFromGateway({
            userContent,
            sessionKey,
            gatewayPort: cfg?.gateway?.port,
            agentId: accountInfo.accountId === '__default__' ? 'main' : accountInfo.accountId,
            systemPrompts,
            gatewayAuth,
            gatewayBaseUrl,
            memoryUser: peerIdOut,
            log
          })) {
            sendStreamChunk(wsTarget, payload, accountInfo, chunk, false, replyId);
          }
          sendStreamChunk(wsTarget, payload, accountInfo, '', true, replyId);
        } catch (err) {
          log?.error?.(`[IntClaw] Gateway stream failed: ${err.message}`);
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

        if (isDone) {
          log?.info?.(`[IntClaw] Stream finished for messageId=${id}`);
        }

        wsTarget.send(JSON.stringify(outMsg));
      };

      connect();

      return new Promise((resolve) => {
        const doStop = () => {
          if (stopped) return;
          stopped = true;
          log?.info?.(`[IntClaw] Stopping client for account: ${account.accountId}`);
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

    probe({ cfg }) {
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