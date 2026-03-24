/**
 * IntClaw消息流 Provider 入口
 *
 * 职责：
 * - 提供 monitorIntclawProvider 函数作为IntClaw消息流的统一入口
 * - 协调单账号和多账号监控场景
 * - 并行导入连接层和消息处理模块，避免循环依赖
 *
 * 主要功能：
 * - 根据 accountId 参数决定启动单账号或所有账号
 * - 验证账号配置状态
 * - 并行启动多个账号的消息流连接
 */
import type { ClawdbotConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import * as monitorState from "./state";

// 只解构 monitorState 的导出
const {
  clearIntclawWebhookRateLimitStateForTest,
  getIntclawWebhookRateLimitStateSizeForTest,
  isWebhookRateLimitedForTest,
  stopIntclawMonitorState,
} = monitorState;

export type MonitorIntclawOpts = {
  config?: ClawdbotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
};

export {
  clearIntclawWebhookRateLimitStateForTest,
  getIntclawWebhookRateLimitStateSizeForTest,
  isWebhookRateLimitedForTest,
} from "./state";

// 只导出类型，不 re-export 函数（避免循环依赖）
export type { IntclawReactionCreatedEvent } from "./connection";

export async function monitorIntclawProvider(opts: MonitorIntclawOpts = {}): Promise<void> {
  const cfg = opts.config;
  if (!cfg) {
    throw new Error("Config is required for IntClaw monitor");
  }

  const log = opts.runtime?.log;

  // 并行导入所有模块（无循环依赖，可以并行）
  const [accountsModule, monitorAccountModule, monitorSingleModule] = await Promise.all([
    import("../config/accounts"),
    import("./message-handler"),
    import("./connection"),
  ]);

  const { resolveIntclawAccount, listEnabledIntclawAccounts } = accountsModule;
  const { handleIntClawMessage } = monitorAccountModule;
  const { monitorSingleAccount, resolveReactionSyntheticEvent } = monitorSingleModule;

  if (opts.accountId) {
    const account = resolveIntclawAccount({ cfg, accountId: opts.accountId });
    log?.info?.(
      `账号状态检查：accountId="${opts.accountId}", enabled=${account.enabled}, configured=${account.configured}`,
    );
    if (!account.enabled || !account.configured) {
      throw new Error(`IntClaw account "${opts.accountId}" not configured or disabled (enabled=${account.enabled}, configured=${account.configured})`);
    }
    return monitorSingleAccount({
      cfg,
      account,
      runtime: opts.runtime,
      abortSignal: opts.abortSignal,
      messageHandler: handleIntClawMessage,
    });
  }

  const accounts = listEnabledIntclawAccounts(cfg);
  if (accounts.length === 0) {
    throw new Error("No enabled IntClaw accounts configured");
  }

  log?.info?.(
    `intclaw-connector: starting ${accounts.length} account(s): ${accounts.map((a) => a.accountId).join(", ")}`,
  );

  const monitorPromises: Promise<void>[] = [];
  for (const account of accounts) {
    if (opts.abortSignal?.aborted) {
      log?.info?.("intclaw-connector: abort signal received during startup preflight; stopping startup");
      break;
    }

    monitorPromises.push(
      monitorSingleAccount({
        cfg,
        account,
        runtime: opts.runtime,
        abortSignal: opts.abortSignal,
        messageHandler: handleIntClawMessage,
      }),
    );
  }

  await Promise.all(monitorPromises);
}

export function stopIntclawMonitor(accountId?: string): void {
  stopIntclawMonitorState(accountId);
}
