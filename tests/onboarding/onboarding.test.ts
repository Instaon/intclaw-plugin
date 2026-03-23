import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPromptSingleChannelSecretInput = vi.hoisted(() => vi.fn());
const mockResolveIntclawCredentials = vi.hoisted(() => vi.fn());
const mockProbeIntclaw = vi.hoisted(() => vi.fn());
const mockHasConfiguredSecretInput = vi.hoisted(() => vi.fn());
const mockAddWildcardAllowFrom = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk", () => ({
  promptSingleChannelSecretInput: mockPromptSingleChannelSecretInput,
}));

vi.mock("../../src/config/accounts.ts", () => ({
  resolveIntclawCredentials: mockResolveIntclawCredentials,
}));

vi.mock("../../src/probe.ts", () => ({
  probeIntclaw: mockProbeIntclaw,
}));

vi.mock("../../src/sdk/helpers.ts", () => ({
  DEFAULT_ACCOUNT_ID: "__default__",
  formatDocsLink: vi.fn(() => "https://docs.example/intclaw"),
  hasConfiguredSecretInput: mockHasConfiguredSecretInput,
  addWildcardAllowFrom: mockAddWildcardAllowFrom,
}));

describe("intclawOnboardingAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveIntclawCredentials.mockReturnValue(null);
    mockProbeIntclaw.mockResolvedValue({ ok: true, botName: "bot-a" });
    mockHasConfiguredSecretInput.mockReturnValue(false);
    mockAddWildcardAllowFrom.mockImplementation((arr: any[] = []) =>
      Array.from(new Set([...(arr || []), "*"])),
    );
    delete process.env.INTCLAW_CLIENT_ID;
    delete process.env.INTCLAW_CLIENT_SECRET;
    delete process.env.TEST_ENV_CLIENT_ID;
  });

  function createPrompter(overrides?: Partial<any>) {
    return {
      note: vi.fn(async () => undefined),
      text: vi.fn(async () => "user1,user2"),
      select: vi.fn(async () => "open"),
      ...overrides,
    };
  }

  it("getStatus returns needs creds when not configured", async () => {
    const { intclawOnboardingAdapter } = await import("../../src/onboarding");
    const out = await (intclawOnboardingAdapter as any).getStatus({
      cfg: {} as any,
      accountOverrides: undefined,
    });
    expect(out.configured).toBe(false);
    expect(out.statusLines[0]).toContain("needs app credentials");
  });

  it("getStatus returns connected when configured and probe ok", async () => {
    process.env.TEST_ENV_CLIENT_ID = "id-from-env";
    mockHasConfiguredSecretInput.mockReturnValue(true);
    mockResolveIntclawCredentials.mockReturnValue({
      clientId: "id",
      clientSecret: "secret",
    });
    mockProbeIntclaw.mockResolvedValue({ ok: true, botName: "DingBot" });

    const { intclawOnboardingAdapter } = await import("../../src/onboarding");
    const cfg = {
      channels: {
        "intclaw-connector": {
          clientId: { source: "env", id: "TEST_ENV_CLIENT_ID" },
          clientSecret: "sec",
        },
      },
    } as any;
    const out = await (intclawOnboardingAdapter as any).getStatus({
      cfg,
      accountOverrides: undefined,
    });
    expect(out.configured).toBe(true);
    expect(out.statusLines[0]).toContain("connected as DingBot");
  });

  it("configure supports use-env + allowlist group config", async () => {
    process.env.INTCLAW_CLIENT_ID = "env-id";
    process.env.INTCLAW_CLIENT_SECRET = "env-secret";
    mockPromptSingleChannelSecretInput.mockResolvedValue({ action: "use-env" });

    const prompter = createPrompter({
      select: vi.fn(async () => "allowlist"),
      text: vi
        .fn()
        .mockResolvedValueOnce("cid1,cid2"), // group allowlist
    });
    const { intclawOnboardingAdapter } = await import("../../src/onboarding");
    const result = await (intclawOnboardingAdapter as any).configure({
      cfg: { channels: {} } as any,
      prompter: prompter as any,
    });
    const channels = (result.cfg as any).channels;

    expect(result.accountId).toBe("__default__");
    expect(channels["intclaw-connector"].enabled).toBe(true);
    expect(channels["intclaw-connector"].groupPolicy).toBe("allowlist");
    expect(channels["intclaw-connector"].groupAllowFrom).toEqual(["cid1", "cid2"]);
  });

  it("configure supports set-secret flow and probe failure note", async () => {
    mockPromptSingleChannelSecretInput.mockResolvedValue({
      action: "set",
      value: "secret-value",
      resolvedValue: "secret-value",
    });
    mockProbeIntclaw.mockResolvedValue({ ok: false, error: "bad credentials" });

    const prompter = createPrompter({
      text: vi
        .fn()
        .mockResolvedValueOnce("client-id") // prompt client id
        .mockResolvedValueOnce(""), // group allowlist skipped by policy=open
      select: vi.fn(async () => "open"),
    });

    const { intclawOnboardingAdapter } = await import("../../src/onboarding");
    const out = await (intclawOnboardingAdapter as any).configure({
      cfg: { channels: {} } as any,
      prompter: prompter as any,
    });
    const channels = (out.cfg as any).channels;

    expect(channels["intclaw-connector"].clientId).toBe("client-id");
    expect(channels["intclaw-connector"].clientSecret).toBe("secret-value");
    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Connection failed"),
      "IntClaw connection test",
    );
  });

  it("dmPolicy helpers support get/set/prompt", async () => {
    const { intclawOnboardingAdapter } = await import("../../src/onboarding");
    const dmPolicy = intclawOnboardingAdapter.dmPolicy as any;
    const current = dmPolicy.getCurrent({ channels: {} });
    expect(current).toBe("open");

    const cfg1 = dmPolicy.setPolicy(
      { channels: { "intclaw-connector": { allowFrom: ["u1"] } } },
      "open",
    );
    expect(cfg1.channels["intclaw-connector"].allowFrom).toContain("*");

    const prompter = createPrompter({
      text: vi
        .fn()
        .mockResolvedValueOnce("   ")
        .mockResolvedValueOnce("u2, u3"),
    });
    const cfg2 = await dmPolicy.promptAllowFrom({
      cfg: { channels: { "intclaw-connector": { allowFrom: ["u1"] } } },
      prompter,
    });
    expect(cfg2.channels["intclaw-connector"].allowFrom).toEqual(["u1", "u2", "u3"]);
  });

  it("disable marks channel disabled", async () => {
    const { intclawOnboardingAdapter } = await import("../../src/onboarding");
    const out = (intclawOnboardingAdapter as any).disable({
      channels: { "intclaw-connector": {} },
    } as any);
    expect((out as any).channels["intclaw-connector"].enabled).toBe(false);
  });
});
