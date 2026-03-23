import { describe, expect, it } from "vitest";
import { IntclawConfigSchema } from "../../src/config/schema";

describe("IntclawConfigSchema", () => {
  it("applies defaults", () => {
    const out = IntclawConfigSchema.parse({});
    expect(out.dmPolicy).toBe("open");
    expect(out.groupPolicy).toBe("open");
    expect(out.requireMention).toBe(true);
  });

  it("rejects unknown defaultAccount when accounts provided", () => {
    expect(() =>
      IntclawConfigSchema.parse({
        defaultAccount: "missing",
        accounts: { main: { enabled: true } },
      }),
    ).toThrow(/defaultAccount/);
  });

  it("requires allowFrom when dmPolicy is allowlist", () => {
    expect(() => IntclawConfigSchema.parse({ dmPolicy: "allowlist", allowFrom: [] })).toThrow(/allowFrom/);
  });
});
