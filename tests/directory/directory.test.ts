import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveIntclawAccount = vi.hoisted(() => vi.fn());

vi.mock("../../src/config/accounts.ts", () => ({
  resolveIntclawAccount: mockResolveIntclawAccount,
}));

describe("directory helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists peers from allowFrom and normalizes ids", async () => {
    const { listIntclawDirectoryPeers } = await import("../../src/directory");
    mockResolveIntclawAccount.mockReturnValue({
      config: {
        allowFrom: [" user:a ", "intclaw:user:b", "*", "user:a"],
      },
    });

    const peers = await listIntclawDirectoryPeers({ cfg: {} as any });
    expect(peers).toEqual([
      { kind: "user", id: "a" },
      { kind: "user", id: "b" },
    ]);
  });

  it("filters peers by query and limit", async () => {
    const { listIntclawDirectoryPeers } = await import("../../src/directory");
    mockResolveIntclawAccount.mockReturnValue({
      config: { allowFrom: ["alice", "bob", "charlie"] },
    });

    const peers = await listIntclawDirectoryPeers({
      cfg: {} as any,
      query: "b",
      limit: 1,
    });
    expect(peers).toEqual([{ kind: "user", id: "bob" }]);
  });

  it("lists groups from groups + groupAllowFrom and de-duplicates", async () => {
    const { listIntclawDirectoryGroups } = await import("../../src/directory");
    mockResolveIntclawAccount.mockReturnValue({
      config: {
        groups: {
          g1: {},
          " g2 ": {},
          "*": {},
        },
        groupAllowFrom: ["g2", "g3", "*"],
      },
    });

    const groups = await listIntclawDirectoryGroups({ cfg: {} as any });
    expect(groups).toEqual([
      { kind: "group", id: "g1" },
      { kind: "group", id: "g2" },
      { kind: "group", id: "g3" },
    ]);
  });

  it("live list functions fallback to static list", async () => {
    const {
      listIntclawDirectoryPeersLive,
      listIntclawDirectoryGroupsLive,
    } = await import("../../src/directory");
    mockResolveIntclawAccount.mockReturnValue({
      config: {
        allowFrom: ["user:abc"],
        groups: { g1: {} },
      },
    });

    const peers = await listIntclawDirectoryPeersLive({ cfg: {} as any });
    const groups = await listIntclawDirectoryGroupsLive({ cfg: {} as any });

    expect(peers).toEqual([{ kind: "user", id: "abc" }]);
    expect(groups).toEqual([{ kind: "group", id: "g1" }]);
  });
});
