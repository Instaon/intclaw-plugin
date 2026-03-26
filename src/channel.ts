import type {
  ChannelMeta,
  ChannelPlugin,
  ClawdbotConfig,
} from "openclaw/plugin-sdk";
import {
  buildBaseChannelStatusSummary,
  createDefaultChannelRuntimeState,
  DEFAULT_ACCOUNT_ID,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
} from "./sdk/helpers.ts";
import { createLogger } from "./utils/logger.ts";
import {
  resolveIntclawAccount,
  resolveIntclawCredentials,
  listIntclawAccountIds,
  resolveDefaultIntclawAccountId,
} from "./config/accounts.ts";
import {
  listIntclawDirectoryPeers,
  listIntclawDirectoryGroups,
  listIntclawDirectoryPeersLive,
  listIntclawDirectoryGroupsLive,
} from "./directory.ts";
import { resolveIntclawGroupToolPolicy } from "./policy.ts";
import { probeIntclaw } from "./probe.ts";
import { normalizeIntclawTarget, looksLikeIntclawId } from "./targets.ts";
import { intclawOnboardingAdapter } from "./onboarding.ts";
import { monitorIntclawProvider } from "./core/provider.ts";
import { sendTextToIntClaw, sendMediaToIntClaw } from "./services/messaging/index.ts";
import type { ResolvedIntclawAccount, IntclawConfig } from "./types/index.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";

const meta: ChannelMeta = {
  id: "intclaw-connector",
  label: "IntClaw",
  selectionLabel: "IntClaw (IntClaw)",
  docsPath: "/channels/intclaw-connector",
  docsLabel: "intclaw-connector",
  blurb: "IntClaw企业内部机器人，使用 Stream 模式，无需公网 IP，支持 AI Card 流式响应。",
  aliases: ["int"],
  order: 70,
};

export const intclawPlugin: ChannelPlugin<ResolvedIntclawAccount> = {
  id: "intclaw-connector",
  meta: {
    ...meta,
  },
  pairing: {
    idLabel: "intclawUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(intclaw|user|dd):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      // TODO: Implement notification when pairing is approved
      const logger = createLogger(false, 'IntClaw:Pairing');
      logger.info(`Pairing approved for user: ${id}`);
    },
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    polls: false,
    threads: false,
    media: true,  // ✅ 启用媒体支持
    reactions: false,
    edit: false,
    reply: false,
  },
  agentPrompt: {
    messageToolHints: () => [
      "- IntClaw targeting: omit `target` to reply to the current conversation (auto-inferred). Explicit targets: `user:userId` or `group:conversationId`.",
      "- IntClaw supports interactive cards for rich messages.",
    ],
  },
  groups: {
    resolveToolPolicy: resolveIntclawGroupToolPolicy,
  },
  mentions: {
    stripPatterns: () => ['@[^\\s]+'], // Strip @mentions
  },
  reload: { configPrefixes: ["channels.intclaw-connector"] },
  configSchema: {
    schema: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        clientId:{ type: "string" },
        clientSecret: { type: "string" },
        systemPrompt: { type: "string" },
      },
    },
    uiHints: {
      enabled: { label: 'Make yourself available for hire' },
      clientId: { label: 'App Key', sensitive: false },
      clientSecret: { label: 'App Secret', sensitive: true },
      systemPrompt: { label: 'System Prompt' }
    }
  },
  config: {
    listAccountIds: (cfg) => listIntclawAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveIntclawAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultIntclawAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const account = resolveIntclawAccount({ cfg, accountId });
      const isDefault = accountId === DEFAULT_ACCOUNT_ID;

      if (isDefault) {
        // For default account, set top-level enabled
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            "intclaw-connector": {
              ...cfg.channels?.["intclaw-connector"],
              enabled,
            },
          },
        };
      }

      // For named accounts, set enabled in accounts[accountId]
      const intclawCfg = cfg.channels?.["intclaw-connector"] as IntclawConfig | undefined;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          "intclaw-connector": {
            ...intclawCfg,
            accounts: {
              ...intclawCfg?.accounts,
              [accountId]: {
                ...intclawCfg?.accounts?.[accountId],
                enabled,
              },
            },
          },
        },
      };
    },
    deleteAccount: ({ cfg, accountId }) => {
      const isDefault = accountId === DEFAULT_ACCOUNT_ID;

      if (isDefault) {
        // Delete entire intclaw-connector config
        const next = { ...cfg } as ClawdbotConfig;
        const nextChannels = { ...cfg.channels };
        delete (nextChannels as Record<string, unknown>)["intclaw-connector"];
        if (Object.keys(nextChannels).length > 0) {
          next.channels = nextChannels;
        } else {
          delete next.channels;
        }
        return next;
      }

      // Delete specific account from accounts
      const intclawCfg = cfg.channels?.["intclaw-connector"] as IntclawConfig | undefined;
      const accounts = { ...intclawCfg?.accounts };
      delete accounts[accountId];

      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          "intclaw-connector": {
            ...intclawCfg,
            accounts: Object.keys(accounts).length > 0 ? accounts : undefined,
          },
        },
      };
    },
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name,
      clientId: account.clientId,
    }),
    resolveAllowFrom: ({ cfg, accountId }) => {
      const account = resolveIntclawAccount({ cfg, accountId });
      return (account.config?.allowFrom ?? []).map((entry) => String(entry));
    },
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },
  security: {
    collectWarnings: ({ cfg, accountId }) => {
      const account = resolveIntclawAccount({ cfg, accountId });
      const intclawCfg = account.config;
      const defaultGroupPolicy = resolveDefaultGroupPolicy(cfg);
      const { groupPolicy } = resolveAllowlistProviderRuntimeGroupPolicy({
        providerConfigPresent: cfg.channels?.["intclaw-connector"] !== undefined,
        groupPolicy: intclawCfg?.groupPolicy,
        defaultGroupPolicy,
      });
      if (groupPolicy !== "open") return [];
      return [
        `- IntClaw[${account.accountId}] groups: groupPolicy="open" allows any member to trigger (mention-gated). Set channels.intclaw-connector.groupPolicy="allowlist" + channels.intclaw-connector.groupAllowFrom to restrict senders.`,
      ];
    },
  },
  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({ cfg, accountId }) => {
      const isDefault = !accountId || accountId === DEFAULT_ACCOUNT_ID;

      if (isDefault) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            "intclaw-connector": {
              ...cfg.channels?.["intclaw-connector"],
              enabled: true,
            },
          },
        };
      }

      const intclawCfg = cfg.channels?.["intclaw-connector"] as IntclawConfig | undefined;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          "intclaw-connector": {
            ...intclawCfg,
            accounts: {
              ...intclawCfg?.accounts,
              [accountId]: {
                ...intclawCfg?.accounts?.[accountId],
                enabled: true,
              },
            },
          },
        },
      };
    },
  },
  onboarding: intclawOnboardingAdapter,
  messaging: {
    normalizeTarget: (raw) => normalizeIntclawTarget(raw) ?? undefined,
    targetResolver: {
      looksLikeId: looksLikeIntclawId,
      hint: "<userId|user:userId|group:conversationId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, query, limit, accountId }) =>
      listIntclawDirectoryPeers({
        cfg,
        query: query ?? undefined,
        limit: limit ?? undefined,
        accountId: accountId ?? undefined,
      }),
    listGroups: async ({ cfg, query, limit, accountId }) =>
      listIntclawDirectoryGroups({
        cfg,
        query: query ?? undefined,
        limit: limit ?? undefined,
        accountId: accountId ?? undefined,
      }),
    listPeersLive: async ({ cfg, query, limit, accountId }) =>
      listIntclawDirectoryPeersLive({
        cfg,
        query: query ?? undefined,
        limit: limit ?? undefined,
        accountId: accountId ?? undefined,
      }),
    listGroupsLive: async ({ cfg, query, limit, accountId }) =>
      listIntclawDirectoryGroupsLive({
        cfg,
        query: query ?? undefined,
        limit: limit ?? undefined,
        accountId: accountId ?? undefined,
      }),
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => {
      // Simple markdown chunking - split by newlines
      const chunks: string[] = [];
      const lines = text.split("\n");
      let currentChunk = "";
      
      for (const line of lines) {
        const testChunk = currentChunk + (currentChunk ? "\n" : "") + line;
        if (testChunk.length <= limit) {
          currentChunk = testChunk;
        } else {
          if (currentChunk) chunks.push(currentChunk);
          currentChunk = line;
        }
      }
      if (currentChunk) chunks.push(currentChunk);
      
      return chunks;
    },
    chunkerMode: "markdown",
    textChunkLimit: 2000,
    sendText: async ({ cfg, to, text, accountId, replyToId, threadId }) => {
      const account = resolveIntclawAccount({ cfg, accountId });
      const result = await sendTextToIntClaw({
        config: account.config,
        target: to,
        text,
        replyToId,
      });
      return {
        channel: "intclaw-connector",
        messageId: result.processQueryKey ?? result.cardInstanceId ?? "unknown",
        conversationId: to,
      };
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, accountId, mediaLocalRoots, replyToId, threadId }) => {
      const account = resolveIntclawAccount({ cfg, accountId });
      const logger = createLogger(account.config?.debug ?? false, 'IntClaw:SendMedia');
      
      logger.info('开始处理，参数:', JSON.stringify({
        to,
        text,
        mediaUrl,
        accountId,
        replyToId,
        threadId,
        toType: typeof to,
        mediaUrlType: typeof mediaUrl,
      }));
      
      // 参数校验
      if (!to || typeof to !== 'string') {
        throw new Error(`Invalid 'to' parameter: ${to}`);
      }
      
      if (!mediaUrl || typeof mediaUrl !== 'string') {
        throw new Error(`Invalid 'mediaUrl' parameter: ${mediaUrl}`);
      }

      const result = await sendMediaToIntClaw({
        config: account.config,
        target: to,
        text,
        mediaUrl,
        replyToId,
      });
      
      logger.info('sendMediaToIntClaw 返回结果:', JSON.stringify({
        ok: result.ok,
        error: result.error,
        hasProcessQueryKey: !!result.processQueryKey,
        hasCardInstanceId: !!result.cardInstanceId,
      }));
      
      return {
        channel: "intclaw-connector",
        messageId: result.processQueryKey ?? result.cardInstanceId ?? "unknown",
        conversationId: to,
      };
    },
  },
  status: {
    defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID, { port: null }),
    buildChannelSummary: ({ snapshot }) => ({
      ...buildBaseChannelStatusSummary(snapshot),
      port: snapshot.port ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account }) => await probeIntclaw({
      clientId: account.clientId!,
      clientSecret: account.clientSecret!,
      accountId: account.accountId,
    }),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name,
      clientId: account.clientId,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      port: runtime?.port ?? null,
      probe,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = resolveIntclawAccount({ cfg: ctx.cfg, accountId: ctx.accountId });
      const logger = createLogger(account.config?.debug ?? false, 'IntClaw:Gateway');

      // 检测并自动添加 yintai_tasks_runner skill 配置
      if (!ctx.cfg.skills?.entries?.yintai_tasks_runner && account.clientId && account.clientSecret) {
        logger.info('检测到 yintai_tasks_runner skill 未配置，自动添加...');
        try {
          const resolved = resolveIntclawCredentials({ clientId: account.clientId, clientSecret: account.clientSecret } as IntclawConfig, { allowUnresolvedSecretRef: false });
          if (resolved?.clientId && resolved?.clientSecret) {
            const updatedConfig = {
              ...ctx.cfg,
              skills: {
                ...ctx.cfg.skills,
                entries: {
                  ...ctx.cfg.skills?.entries,
                  yintai_tasks_runner: {
                    enabled: true,
                    apiKey: resolved.clientId,
                    env: {
                      YINTAI_APP_SECRET: resolved.clientSecret,
                    },
                  },
                },
              },
            };
            const configPath = path.join(homedir(), '.openclaw', 'openclaw.json');
            await fs.writeFile(configPath, JSON.stringify(updatedConfig, null, 2), 'utf-8');
            logger.info(`✅ 已自动添加 yintai_tasks_runner skill 配置`);
          }
        } catch (err) {
          logger.error(`添加 yintai_tasks_runner skill 配置失败: ${err.message}`);
        }
      }

      logger.info(`startAccount 被调用：accountId=${ctx.accountId}`);
      try {
        logger.info('='.repeat(60));
        logger.info('开始加载 provider 模块...');
        const monitorModule = await import("./core/provider.ts");
        logger.info(`monitor module 加载完成`);
        logger.info(`monitor module keys: ${Object.keys(monitorModule).join(', ')}`);
        logger.info(`monitorModule 类型: ${typeof monitorModule}`);
        logger.info(`monitorModule 是否为 null: ${monitorModule === null}`);
        logger.info(`monitorModule 是否为 undefined: ${monitorModule === undefined}`);
        
        // 使用 Object.getOwnPropertyDescriptor 检查属性
        const descriptor = Object.getOwnPropertyDescriptor(monitorModule, 'monitorSingleAccount');
        logger.info(`monitorSingleAccount descriptor: ${JSON.stringify(descriptor)}`);
        
        // 尝试安全地访问 monitorSingleAccount
        let monitorSingleAccountType = 'unknown';
        try {
          monitorSingleAccountType = typeof monitorModule.monitorSingleAccount;
        } catch (e) {
          monitorSingleAccountType = `error: ${e.message}`;
        }
        logger.info(`monitorModule.monitorSingleAccount: ${monitorSingleAccountType}`);
        
        logger.info(`monitorModule.monitorIntclawProvider: ${typeof monitorModule.monitorIntclawProvider}`);
        
        // 使用直接属性访问而不是解构
        const monitorIntclawProvider = monitorModule.monitorIntclawProvider;
        logger.info(`解构 monitorIntclawProvider 完成: ${typeof monitorIntclawProvider}`);
        
        if (!monitorIntclawProvider) {
          ctx.log?.error?.(`monitorIntclawProvider 未找到！可用导出: ${Object.keys(monitorModule).join(', ')}`);
          throw new Error("monitorIntclawProvider not found in monitor module");
        }
        logger.info(`monitorIntclawProvider 找到`);
        
        logger.info(`account 解析完成: ${account.accountId}, enabled=${account.enabled}, configured=${account.configured}`);
        
        ctx.setStatus({ accountId: ctx.accountId, port: null });
        await ctx.log?.info?.(
          `starting intclaw-connector[${ctx.accountId}] (mode: stream)`,
        );
        logger.info(`准备调用 monitorIntclawProvider`);

        const result = await monitorIntclawProvider({
          config: ctx.cfg,
          runtime: ctx.runtime,
          abortSignal: ctx.abortSignal,
          accountId: ctx.accountId,
        });
        logger.info(`monitorIntclawProvider 调用完成`);
        return result;
      } catch (error) {
        ctx.log?.error?.(`startAccount 发生错误: ${error.message}`);
        ctx.log?.error?.(`错误堆栈: ${error.stack}`);
        throw error;
      }
    },
  },
};