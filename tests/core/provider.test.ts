import { beforeEach, describe, expect, it, vi } from "vitest";

describe("core/provider", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function loadProviderWithMocks(params?: {
    resolvedAccount?: any;
    accounts?: any[];
    abortSignal?: AbortSignal;
  }) {
    const monitorSingleAccount = vi.fn().mockResolvedValue(undefined);
    const handleIntClawMessage = vi.fn();
    const resolveReactionSyntheticEvent = vi.fn();
    const stopIntclawMonitorState = vi.fn();

    vi.doMock("../../src/config/accounts", () => ({
      resolveIntclawAccount: vi.fn().mockReturnValue(
        params?.resolvedAccount ?? {
          accountId: "acc-1",
          enabled: true,
          configured: true,
        },
      ),
      listEnabledIntclawAccounts: vi.fn().mockReturnValue(
        params?.accounts ?? [{ accountId: "acc-1", enabled: true, configured: true }],
      ),
    }));

    vi.doMock("../../src/core/message-handler", () => ({
      handleIntClawMessage,
    }));

    vi.doMock("../../src/core/connection", () => ({
      monitorSingleAccount,
      resolveReactionSyntheticEvent,
    }));

    vi.doMock("../../src/core/state", () => ({
      clearIntclawWebhookRateLimitStateForTest: vi.fn(),
      getIntclawWebhookRateLimitStateSizeForTest: vi.fn().mockReturnValue(0),
      isWebhookRateLimitedForTest: vi.fn().mockReturnValue(false),
      stopIntclawMonitorState,
    }));

    const provider = await import("../../src/core/provider");
    return {
      provider,
      monitorSingleAccount,
      handleIntClawMessage,
      stopIntclawMonitorState,
    };
  }

  it("throws when config is missing", async () => {
    const { provider } = await loadProviderWithMocks();
    await expect(provider.monitorIntclawProvider({})).rejects.toThrow(
      "Config is required for IntClaw monitor",
    );
  });

  it("throws for disabled or unconfigured single account", async () => {
    const { provider } = await loadProviderWithMocks({
      resolvedAccount: { accountId: "acc-1", enabled: false, configured: false },
    });

    await expect(
      provider.monitorIntclawProvider({ config: {} as any, accountId: "acc-1" }),
    ).rejects.toThrow('IntClaw account "acc-1" not configured or disabled');
  });

  it("starts single account monitor with handler", async () => {
    const { provider, monitorSingleAccount, handleIntClawMessage } = await loadProviderWithMocks();

    await provider.monitorIntclawProvider({
      config: {} as any,
      accountId: "acc-1",
      runtime: { log: { info: vi.fn() } } as any,
    });

    expect(monitorSingleAccount).toHaveBeenCalledTimes(1);
    expect(monitorSingleAccount.mock.calls[0][0]).toMatchObject({
      account: { accountId: "acc-1", enabled: true, configured: true },
      messageHandler: handleIntClawMessage,
    });
  });

  it("throws when no enabled account found in multi-account mode", async () => {
    const { provider } = await loadProviderWithMocks({ accounts: [] });
    await expect(provider.monitorIntclawProvider({ config: {} as any })).rejects.toThrow(
      "No enabled IntClaw accounts configured",
    );
  });

  it("starts all enabled accounts in multi-account mode", async () => {
    const accounts = [
      { accountId: "a-1", enabled: true, configured: true },
      { accountId: "a-2", enabled: true, configured: true },
    ];
    const info = vi.fn();
    const { provider, monitorSingleAccount } = await loadProviderWithMocks({ accounts });

    await provider.monitorIntclawProvider({
      config: {} as any,
      runtime: { log: { info } } as any,
    });

    expect(info).toHaveBeenCalledTimes(1);
    expect(monitorSingleAccount).toHaveBeenCalledTimes(2);
  });

  it("stops startup preflight when abort signal already aborted", async () => {
    const accounts = [{ accountId: "a-1", enabled: true, configured: true }];
    const controller = new AbortController();
    controller.abort();
    const info = vi.fn();
    const { provider, monitorSingleAccount } = await loadProviderWithMocks({ accounts });

    await provider.monitorIntclawProvider({
      config: {} as any,
      abortSignal: controller.signal,
      runtime: { log: { info } } as any,
    });

    expect(info).toHaveBeenCalledTimes(2);
    expect(info.mock.calls[1][0]).toContain("abort signal received during startup preflight");
    expect(monitorSingleAccount).not.toHaveBeenCalled();
  });

  it("delegates stopIntclawMonitor to state layer", async () => {
    const { provider, stopIntclawMonitorState } = await loadProviderWithMocks();
    provider.stopIntclawMonitor("acc-1");
    expect(stopIntclawMonitorState).toHaveBeenCalledWith("acc-1");
  });
});
