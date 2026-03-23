import { describe, expect, it } from "vitest";
import {
  formatIntclawTarget,
  looksLikeIntclawId,
  normalizeIntclawTarget,
} from "../../src/targets";

describe("targets helpers", () => {
  describe("normalizeIntclawTarget", () => {
    it("returns null for empty value", () => {
      expect(normalizeIntclawTarget("   ")).toBeNull();
    });

    it("normalizes provider-prefixed user target", () => {
      expect(normalizeIntclawTarget("intclaw:user:abc")).toBe("abc");
      expect(normalizeIntclawTarget("dd:user: abc ")).toBe("abc");
      expect(normalizeIntclawTarget("ding:user:abc")).toBe("abc");
    });

    it("normalizes provider-prefixed group target", () => {
      expect(normalizeIntclawTarget("intclaw:group:conv-1")).toBe("conv-1");
    });

    it("returns null for empty explicit user/group suffix", () => {
      expect(normalizeIntclawTarget("user:")).toBeNull();
      expect(normalizeIntclawTarget("group:   ")).toBeNull();
    });

    it("returns id directly when no user/group marker", () => {
      expect(normalizeIntclawTarget("  user-id-001  ")).toBe("user-id-001");
    });
  });

  describe("formatIntclawTarget", () => {
    it("formats group and user targets", () => {
      expect(formatIntclawTarget(" conv ", "group")).toBe("group:conv");
      expect(formatIntclawTarget(" user ", "user")).toBe("user:user");
    });

    it("returns trimmed id when type missing", () => {
      expect(formatIntclawTarget("  raw  ")).toBe("raw");
    });
  });

  describe("looksLikeIntclawId", () => {
    it("returns false for blank input", () => {
      expect(looksLikeIntclawId("")).toBe(false);
      expect(looksLikeIntclawId("  ")).toBe(false);
    });

    it("returns true for raw and explicit targets", () => {
      expect(looksLikeIntclawId("abc")).toBe(true);
      expect(looksLikeIntclawId("user:abc")).toBe(true);
      expect(looksLikeIntclawId("group:conv")).toBe(true);
      expect(looksLikeIntclawId("intclaw:user:abc")).toBe(true);
    });
  });
});
