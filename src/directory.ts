import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { resolveIntclawAccount } from "./config/accounts.ts";
import { normalizeIntclawTarget } from "./targets.ts";

export type IntclawDirectoryPeer = {
  kind: "user";
  id: string;
  name?: string;
};

export type IntclawDirectoryGroup = {
  kind: "group";
  id: string;
  name?: string;
};

export async function listIntclawDirectoryPeers(params: {
  cfg: ClawdbotConfig;
  query?: string;
  limit?: number;
  accountId?: string;
}): Promise<IntclawDirectoryPeer[]> {
  const account = resolveIntclawAccount({ cfg: params.cfg, accountId: params.accountId });
  const intclawCfg = account.config;
  const q = params.query?.trim().toLowerCase() || "";
  const ids = new Set<string>();

  for (const entry of intclawCfg?.allowFrom ?? []) {
    const trimmed = String(entry).trim();
    if (trimmed && trimmed !== "*") {
      ids.add(trimmed);
    }
  }

  return Array.from(ids)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => normalizeIntclawTarget(raw) ?? raw)
    .filter((id) => (q ? id.toLowerCase().includes(q) : true))
    .slice(0, params.limit && params.limit > 0 ? params.limit : undefined)
    .map((id) => ({ kind: "user" as const, id }));
}

export async function listIntclawDirectoryGroups(params: {
  cfg: ClawdbotConfig;
  query?: string;
  limit?: number;
  accountId?: string;
}): Promise<IntclawDirectoryGroup[]> {
  const account = resolveIntclawAccount({ cfg: params.cfg, accountId: params.accountId });
  const intclawCfg = account.config;
  const q = params.query?.trim().toLowerCase() || "";
  const ids = new Set<string>();

  for (const groupId of Object.keys(intclawCfg?.groups ?? {})) {
    const trimmed = groupId.trim();
    if (trimmed && trimmed !== "*") {
      ids.add(trimmed);
    }
  }

  for (const entry of intclawCfg?.groupAllowFrom ?? []) {
    const trimmed = String(entry).trim();
    if (trimmed && trimmed !== "*") {
      ids.add(trimmed);
    }
  }

  return Array.from(ids)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .filter((id) => (q ? id.toLowerCase().includes(q) : true))
    .slice(0, params.limit && params.limit > 0 ? params.limit : undefined)
    .map((id) => ({ kind: "group" as const, id }));
}

export async function listIntclawDirectoryPeersLive(params: {
  cfg: ClawdbotConfig;
  query?: string;
  limit?: number;
  accountId?: string;
}): Promise<IntclawDirectoryPeer[]> {
  // IntClaw doesn't have a public API to list users, so we fall back to static list
  return listIntclawDirectoryPeers(params);
}

export async function listIntclawDirectoryGroupsLive(params: {
  cfg: ClawdbotConfig;
  query?: string;
  limit?: number;
  accountId?: string;
}): Promise<IntclawDirectoryGroup[]> {
  // IntClaw doesn't have a public API to list groups, so we fall back to static list
  return listIntclawDirectoryGroups(params);
}
