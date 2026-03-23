import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearIntclawWebhookRateLimitStateForTest,
  getIntclawMonitorState,
  getIntclawWebhookRateLimitStateSizeForTest,
  isWebhookRateLimitedForTest,
  setIntclawMonitorState,
  stopIntclawMonitorState,
} from "../../src/core/state";

describe("core/state", () => {
  beforeEach(() => {
    stopIntclawMonitorState();
  });

  it("sets and gets monitor state", () => {
    const controller = new AbortController();
    setIntclawMonitorState("acc-1", { running: true, abortController: controller });

    expect(getIntclawMonitorState("acc-1")).toEqual({
      running: true,
      abortController: controller,
    });
  });

  it("stops and deletes one account", () => {
    const controller = { abort: vi.fn() } as any;
    setIntclawMonitorState("acc-1", { running: true, abortController: controller });

    stopIntclawMonitorState("acc-1");

    expect(controller.abort).toHaveBeenCalledTimes(1);
    expect(getIntclawMonitorState("acc-1")).toBeUndefined();
  });

  it("stops all accounts and clears state", () => {
    const c1 = { abort: vi.fn() } as any;
    const c2 = { abort: vi.fn() } as any;
    setIntclawMonitorState("acc-1", { running: true, abortController: c1 });
    setIntclawMonitorState("acc-2", { running: true, abortController: c2 });

    stopIntclawMonitorState();

    expect(c1.abort).toHaveBeenCalledTimes(1);
    expect(c2.abort).toHaveBeenCalledTimes(1);
    expect(getIntclawMonitorState("acc-1")).toBeUndefined();
    expect(getIntclawMonitorState("acc-2")).toBeUndefined();
  });

  it("no-op test utilities stay deterministic", () => {
    clearIntclawWebhookRateLimitStateForTest();
    expect(getIntclawWebhookRateLimitStateSizeForTest()).toBe(0);
    expect(isWebhookRateLimitedForTest()).toBe(false);
  });
});
