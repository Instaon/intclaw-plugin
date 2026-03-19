let runtime = null;

function getRuntime() {
  if (!runtime) throw new Error('runtime not initialized');
  return runtime;
}

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

const helloChannel = {
  id: 'hello-channel',

  meta: {
    capabilities: {
      chatTypes: ['direct'],
      reactions: false,
      threads: false,
      media: false,
      nativeCommands: false,
      blockStreaming: false,
    },
  },

  config: {
    listAccountIds() {
      return ['default'];
    },

    resolveAccount(cfg, accountId) {
      return {
        accountId: accountId || 'default',
        config: {},
        enabled: true,
      };
    },

    defaultAccountId: 'default',

    isConfigured() {
      return true;
    },

    describeAccount(account) {
      return {
        accountId: account.accountId,
        name: 'Hello Channel',
        enabled: true,
        configured: true,
      };
    },
  },

  outbound: {
    deliveryMode: 'direct',
    textChunkLimit: 4000,

    async sendText(ctx) {
      process.stdout.write(`[outbound] ${ctx.text}\n`);
      return {
        channel: 'hello-channel',
        messageId: `msg_${Date.now()}`,
      };
    },
  },

  gateway: {
    async startAccount(ctx) {
      const { account, abortSignal } = ctx;
      let stopped = false;

      const runOnce = async () => {
        const text = '你好，你在吗';
        const sessionContext = {
          channel: 'hello-channel',
          accountId: account.accountId,
          chatType: 'direct',
          peerId: 'demo-user',
        };
        const sessionKey = JSON.stringify(sessionContext);

        try {
          process.stdout.write(`\n[send] ${text}\n[recv] `);

          for await (const chunk of streamFromGateway({
            userContent: text,
            sessionKey,
            gatewayPort: ctx.cfg?.gateway?.port,
            agentId: 'main',
          })) {
            process.stdout.write(chunk);
          }

          process.stdout.write('\n');
        } catch (err) {
          process.stderr.write(`[error] ${err.message}\n`);
        }
      };

      await runOnce();
      const timer = setInterval(runOnce, 10000);

      const doStop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
      };

      return new Promise((resolve) => {
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
      accountId: 'default',
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },

    async probe() {
      return { ok: true };
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

const plugin = {
  id: 'hello-channel',
  name: 'Hello Channel',
  description: 'Minimal hello channel for OpenClaw',
  configSchema: {
    type: 'object',
    additionalProperties: true,
    properties: {
      enabled: { type: 'boolean', default: true },
    },
  },

  register(api) {
    runtime = api.runtime;
    api.registerChannel({ plugin: helloChannel });
  },
};

module.exports = plugin;
module.exports.helloChannel = helloChannel;
