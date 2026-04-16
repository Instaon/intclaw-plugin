import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";

export const CHANNEL_ID = "insta-claw-connector" as const;

export interface ResolvedInstaClawAccount {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
  clientId?: string;
  clientSecret?: string;
  systemPrompt?: string;
  config: Record<string, unknown>;
}

export function listInstaClawAccountIds(cfg: any): string[] {
  const accounts = cfg.channels?.[CHANNEL_ID]?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [DEFAULT_ACCOUNT_ID];
  }

  const ids = Object.keys(accounts).filter(Boolean);
  return ids.length > 0 ? [...ids].sort() : [DEFAULT_ACCOUNT_ID];
}

export function resolveInstaClawAccount(cfg: any, accountId?: string | null): ResolvedInstaClawAccount {
  const hasExplicitAccountId = typeof accountId === "string" && accountId.trim() !== "";
  const resolvedAccountId = hasExplicitAccountId ? accountId! : DEFAULT_ACCOUNT_ID;
  const channelCfg = cfg.channels?.[CHANNEL_ID] ?? {};

  let merged = { ...channelCfg };
  if (hasExplicitAccountId && channelCfg.accounts?.[resolvedAccountId]) {
    const { accounts: _ignored, defaultAccount: _ignoredDefault, ...base } = channelCfg;
    merged = { ...base, ...channelCfg.accounts[resolvedAccountId] };
  }

  const enabled = merged.enabled !== false;
  const clientId = typeof merged.clientId === "string" ? merged.clientId.trim() || undefined : undefined;
  const clientSecret = typeof merged.clientSecret === "string" ? merged.clientSecret.trim() || undefined : undefined;

  return {
    accountId: resolvedAccountId,
    enabled,
    configured: Boolean(clientId && clientSecret),
    name: typeof merged.name === "string" ? merged.name.trim() || undefined : undefined,
    clientId,
    clientSecret,
    systemPrompt: typeof merged.systemPrompt === "string" ? merged.systemPrompt.trim() || undefined : undefined,
    config: merged,
  };
}
