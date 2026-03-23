import { describe, expect, it } from "vitest";
import { resolveIntclawGroupToolPolicy } from "../../src/policy";

describe("resolveIntclawGroupToolPolicy", () => {
  it("returns group-level tools policy when configured", () => {
    const account = {
      config: {
        groups: {
          g1: {
            tools: { allow: ["sendMessage"], deny: ["deleteMessage"] },
          },
        },
      },
    } as any;

    const policy = resolveIntclawGroupToolPolicy({ account, groupId: "g1" });
    expect(policy).toEqual({ allow: ["sendMessage"], deny: ["deleteMessage"] });
  });

  it("falls back to allow-all policy when group config missing", () => {
    const account = {
      config: {
        groups: {},
      },
    } as any;

    const policy = resolveIntclawGroupToolPolicy({ account, groupId: "missing" });
    expect(policy).toEqual({ allow: ["*"] });
  });
});
