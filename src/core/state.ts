/**
 * IntClaw消息流状态管理
 * 
 * 职责：
 * - 管理每个IntClaw账号的运行状态
 * - 存储 AbortController 用于优雅停止消息流
 * - 提供测试工具函数
 * 
 * 核心功能：
 * - setIntclawMonitorState: 设置账号运行状态
 * - getIntclawMonitorState: 获取账号运行状态
 * - stopIntclawMonitorState: 停止单个或多个账号的消息流
 * - 测试工具：clearIntclawWebhookRateLimitStateForTest 等
 */
import type { IntclawStreamClient } from "../types/index.ts";

const monitorState = new Map<string, { running: boolean; abortController?: AbortController; client?: IntclawStreamClient }>();

export function setIntclawMonitorState(accountId: string, state: { running: boolean; abortController?: AbortController; client?: IntclawStreamClient }): void {
  monitorState.set(accountId, state);
}

export function getIntclawMonitorState(accountId: string): { running: boolean; abortController?: AbortController; client?: IntclawStreamClient } | undefined {
  return monitorState.get(accountId);
}

export function stopIntclawMonitorState(accountId?: string): void {
  if (accountId) {
    const state = monitorState.get(accountId);
    if (state?.abortController) {
      state.abortController.abort();
    }
    monitorState.delete(accountId);
  } else {
    // Stop all monitors
    for (const [id, state] of monitorState.entries()) {
      if (state.abortController) {
        state.abortController.abort();
      }
    }
    monitorState.clear();
  }
}

// Test utilities
export function clearIntclawWebhookRateLimitStateForTest(): void {
  // IntClaw doesn't use webhook rate limiting
}

export function getIntclawWebhookRateLimitStateSizeForTest(): number {
  return 0;
}

export function isWebhookRateLimitedForTest(): boolean {
  return false;
}