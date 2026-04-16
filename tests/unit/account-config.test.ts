import { describe, expect, it } from "vitest";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import { listInstaClawAccountIds, resolveInstaClawAccount } from "../../account-config.js";

describe("account-config", () => {
  it("returns the default account when no accounts are configured", () => {
    expect(listInstaClawAccountIds({})).toEqual([DEFAULT_ACCOUNT_ID]);
  });

  it("merges named account settings on top of base channel config", () => {
    const cfg = {
      channels: {
        "insta-claw-connector": {
          enabled: true,
          clientId: "base-client",
          clientSecret: "base-secret",
          systemPrompt: "base prompt",
          debug: false,
          accounts: {
            brandA: {
              clientId: "brand-client",
              debug: true,
            },
          },
        },
      },
    };

    const account = resolveInstaClawAccount(cfg, "brandA");

    expect(account.accountId).toBe("brandA");
    expect(account.clientId).toBe("brand-client");
    expect(account.clientSecret).toBe("base-secret");
    expect(account.systemPrompt).toBe("base prompt");
    expect(account.config).toMatchObject({
      clientId: "brand-client",
      clientSecret: "base-secret",
      debug: true,
      systemPrompt: "base prompt",
    });
  });
});
