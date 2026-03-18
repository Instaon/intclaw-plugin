/**
 * IntClaw Channel Plugin for OpenClaw
 *
 * This plugin provides a WebSocket-based channel for connecting to IntClaw services.
 * It handles bidirectional message flow between OpenClaw and IntClaw servers.
 */

import type {
  ChannelConfigAdapter,
  ChannelId,
  ChannelLifecycleAdapter,
  ChannelMessagingAdapter,
  ChannelMeta,
  ChannelOutboundAdapter,
  ChannelOutboundTargetMode,
  ChannelPlugin,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { IntClawChannel } from "./channel/IntClawChannel.js";

// Channel metadata
const meta: ChannelMeta = {
  id: "intclaw" as ChannelId,
  label: "IntClaw",
  selectionLabel: "IntClaw",
  docsPath: "/channels/intclaw",
  docsLabel: "IntClaw Plugin Docs",
  blurb: "WebSocket-based channel for IntClaw services - Community Platform, Message Channel, and Agent Collaboration Engine",
  order: 100,
};

// Store active channel instances per account
const activeChannels = new Map<string, IntClawChannel>();

// Config adapter
const config: ChannelConfigAdapter = {
  listAccountIds: (cfg: OpenClawConfig) => {
    const channels = cfg.channels?.intclaw;
    if (!channels) return ["default"];
    if (typeof channels === "boolean") return ["default"];
    const accounts = channels.accounts;
    if (!accounts || Object.keys(accounts).length === 0) return ["default"];
    return Object.keys(accounts);
  },

  resolveConfig: (cfg: OpenClawConfig, accountId: string) => {
    const channels = cfg.channels?.intclaw;
    if (!channels || typeof channels === "boolean") {
      return { enabled: false };
    }
    if (accountId === "default") {
      return {
        enabled: channels.enabled ?? false,
        wsUrl: channels.wsUrl,
        apiKey: channels.apiKey,
        reconnectInterval: channels.reconnectInterval ?? 5000,
        dmPolicy: channels.dmPolicy ?? "pairing",
        allowFrom: channels.allowFrom ?? [],
        groupPolicy: channels.groupPolicy ?? "allowlist",
        groupAllowFrom: channels.groupAllowFrom ?? [],
        groups: channels.groups ?? {},
      };
    }
    const account = channels.accounts?.[accountId];
    if (!account) {
      return { enabled: false };
    }
    return {
      enabled: account.enabled ?? false,
      wsUrl: account.wsUrl ?? channels.wsUrl,
      apiKey: account.apiKey ?? channels.apiKey,
      reconnectInterval: account.reconnectInterval ?? channels.reconnectInterval ?? 5000,
      dmPolicy: account.dmPolicy ?? channels.dmPolicy ?? "pairing",
      allowFrom: account.allowFrom ?? channels.allowFrom ?? [],
      groupPolicy: account.groupPolicy ?? channels.groupPolicy ?? "allowlist",
      groupAllowFrom: account.groupAllowFrom ?? channels.groupAllowFrom ?? [],
      groups: account.groups ?? channels.groups ?? {},
    };
  },

  resolveDefaultAccountId: (cfg: OpenClawConfig) => {
    const channels = cfg.channels?.intclaw;
    if (!channels || typeof channels === "boolean") return "default";
    if (channels.defaultAccount) return channels.defaultAccount;
    const accounts = channels.accounts;
    if (!accounts || Object.keys(accounts).length === 0) return "default";
    return Object.keys(accounts)[0];
  },
};

// Lifecycle adapter - start/stop channels
const lifecycle: ChannelLifecycleAdapter = {
  start: async ({ cfg, accountId }) => {
    const channelConfig = config.resolveConfig(cfg, accountId);
    if (!channelConfig.enabled) {
      return;
    }

    if (!channelConfig.wsUrl || !channelConfig.apiKey) {
      throw new Error(`IntClaw channel [${accountId}] requires wsUrl and apiKey in configuration`);
    }

    const channel = new IntClawChannel(accountId, channelConfig, cfg);
    activeChannels.set(accountId, channel);
    await channel.start();
  },

  stop: async ({ cfg, accountId }) => {
    const channel = activeChannels.get(accountId);
    if (channel) {
      await channel.stop();
      activeChannels.delete(accountId);
    }
  },

  restart: async ({ cfg, accountId }) => {
    await lifecycle.stop({ cfg, accountId });
    await lifecycle.start({ cfg, accountId });
  },
};

// Outbound adapter - send messages
const outbound: ChannelOutboundAdapter = {
  targetMode: "explicit" as ChannelOutboundTargetMode,

  sendMessage: async ({ cfg, to, text, accountId, options }) => {
    const resolvedAccountId = accountId ?? config.resolveDefaultAccountId(cfg);
    const channel = activeChannels.get(resolvedAccountId);

    if (!channel) {
      throw new Error(`IntClaw channel [${resolvedAccountId}] is not active`);
    }

    await channel.send({
      peerId: to,
      text,
      threadId: options?.threadId,
      replyToId: options?.replyToId,
    });
  },
};

// Messaging adapter - handle incoming messages
const messaging: ChannelMessagingAdapter = {
  supportsMultitext: () => false,
  supportsMedia: () => false,
  supportsReactions: () => false,
  supportsEdits: () => false,
  supportsTyping: () => false,
};

// Export the channel plugin
export const intclawPlugin: ChannelPlugin = {
  id: "intclaw" as ChannelId,
  meta,
  capabilities: {
    multitext: false,
    media: false,
    reactions: false,
    edits: false,
    typing: false,
    threads: true,
    groups: true,
    dm: true,
  },
  config,
  lifecycle,
  outbound,
  messaging,
};

// Export the plugin registration function
const plugin = {
  id: "intclaw",
  name: "IntClaw Plugin",
  description: "OpenClaw plugin for IntClaw services - WebSocket-based channel integration for Community Platform, Message Channel, and Agent Collaboration Engine",
  configSchema: emptyPluginConfigSchema(),
  register(api: unknown) {
    // api.registerChannel({ plugin: intclawPlugin });
    // TODO: Properly register the channel when API is available
    console.log("[IntClaw Plugin] Registered (runtime integration pending)");
  },
};

export default plugin;
