import { DEFAULT_ACCOUNT_ID, normalizeAccountId , normalizeResolvedSecretInputString, normalizeSecretInputString } from "../sdk/helpers.ts";
import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import type {
  IntclawConfig,
  IntclawAccountConfig,
  IntclawDefaultAccountSelectionSource,
  ResolvedIntclawAccount,
} from "../types/index.ts";

/**
 * List all configured account IDs from the accounts field.
 */
function listConfiguredAccountIds(cfg: ClawdbotConfig): string[] {
  const accounts = (cfg.channels?.["intclaw-connector"] as IntclawConfig)?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [];
  }
  return Object.keys(accounts).filter(Boolean);
}

/**
 * List all IntClaw account IDs.
 * If no accounts are configured, returns [DEFAULT_ACCOUNT_ID] for backward compatibility.
 */
export function listIntclawAccountIds(cfg: ClawdbotConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    // Backward compatibility: no accounts configured, use default
    return [DEFAULT_ACCOUNT_ID];
  }
  return [...ids].toSorted((a, b) => a.localeCompare(b));
}

/**
 * Resolve the default account selection and its source.
 */
export function resolveDefaultIntclawAccountSelection(cfg: ClawdbotConfig): {
  accountId: string;
  source: IntclawDefaultAccountSelectionSource;
} {
  const preferredRaw = (cfg.channels?.["intclaw-connector"] as IntclawConfig | undefined)?.defaultAccount?.trim();
  const preferred = preferredRaw ? normalizeAccountId(preferredRaw) : undefined;
  if (preferred) {
    return {
      accountId: preferred,
      source: "explicit-default",
    };
  }
  const ids = listIntclawAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return {
      accountId: DEFAULT_ACCOUNT_ID,
      source: "mapped-default",
    };
  }
  return {
    accountId: ids[0] ?? DEFAULT_ACCOUNT_ID,
    source: "fallback",
  };
}

/**
 * Resolve the default account ID.
 */
export function resolveDefaultIntclawAccountId(cfg: ClawdbotConfig): string {
  return resolveDefaultIntclawAccountSelection(cfg).accountId;
}

/**
 * Get the raw account-specific config.
 */
function resolveAccountConfig(
  cfg: ClawdbotConfig,
  accountId: string,
): IntclawAccountConfig | undefined {
  const accounts = (cfg.channels?.["intclaw-connector"] as IntclawConfig)?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  return accounts[accountId];
}

/**
 * Merge top-level config with account-specific config.
 * Account-specific fields override top-level fields.
 */
function mergeIntclawAccountConfig(cfg: ClawdbotConfig, accountId: string): IntclawConfig {
  const intclawCfg = cfg.channels?.["intclaw-connector"] as IntclawConfig | undefined;

  // Extract base config (exclude accounts field to avoid recursion)
  const { accounts: _ignored, defaultAccount: _ignoredDefaultAccount, ...base } = intclawCfg ?? {};

  // Get account-specific overrides
  const account = resolveAccountConfig(cfg, accountId) ?? {};

  // Merge: account config overrides base config
  return { ...base, ...account } as IntclawConfig;
}

/**
 * Resolve IntClaw credentials from a config.
 */
export function resolveIntclawCredentials(cfg?: IntclawConfig): {
  clientId: string;
  clientSecret: string;
} | null;
export function resolveIntclawCredentials(
  cfg: IntclawConfig | undefined,
  options: { allowUnresolvedSecretRef?: boolean },
): {
  clientId: string;
  clientSecret: string;
} | null;
export function resolveIntclawCredentials(
  cfg?: IntclawConfig,
  options?: { allowUnresolvedSecretRef?: boolean },
): {
  clientId: string;
  clientSecret: string;
} | null {
  const normalizeString = (value: unknown): string | undefined => {
    if (typeof value === "number") {
      return String(value);
    }
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  };

  const resolveSecretLike = (value: unknown, path: string): string | undefined => {
    // Missing credential: treat as not configured (no exception).
    // This path is used in non-onboarding contexts (e.g. channel listing/status),
    // so we must not throw when credentials are absent.
    if (value === undefined || value === null) {
      return undefined;
    }

    const asString = normalizeString(value);
    if (asString) {
      return asString;
    }

    // In relaxed/onboarding paths only: allow direct env SecretRef reads for UX.
    // Default resolution path must preserve unresolved-ref diagnostics/policy semantics.
    if (options?.allowUnresolvedSecretRef && typeof value === "object" && value !== null) {
      const rec = value as Record<string, unknown>;
      const source = normalizeString(rec.source)?.toLowerCase();
      const id = normalizeString(rec.id);
      if (source === "env" && id) {
        const envValue = normalizeString(process.env[id]);
        if (envValue) {
          return envValue;
        }
      }
    }

    if (options?.allowUnresolvedSecretRef) {
      return normalizeSecretInputString(value);
    }
    return normalizeResolvedSecretInputString({ value, path });
  };

  const clientId = resolveSecretLike(cfg?.clientId, "channels.intclaw-connector.clientId");
  const clientSecret = resolveSecretLike(cfg?.clientSecret, "channels.intclaw-connector.clientSecret");

  if (!clientId || !clientSecret) {
    return null;
  }
  return {
    clientId,
    clientSecret,
  };
}

/**
 * Resolve a complete IntClaw account with merged config.
 */
export function resolveIntclawAccount(params: {
  cfg: ClawdbotConfig;
  accountId?: string | null;
}): ResolvedIntclawAccount {
  const hasExplicitAccountId =
    typeof params.accountId === "string" && params.accountId.trim() !== "";
  const defaultSelection = hasExplicitAccountId
    ? null
    : resolveDefaultIntclawAccountSelection(params.cfg);
  const accountId = hasExplicitAccountId
    ? normalizeAccountId(params.accountId ?? "")
    : (defaultSelection?.accountId ?? DEFAULT_ACCOUNT_ID);
  const selectionSource = hasExplicitAccountId
    ? "explicit"
    : (defaultSelection?.source ?? "fallback");
  const intclawCfg = params.cfg.channels?.["intclaw-connector"] as IntclawConfig | undefined;

  // Base enabled state (top-level)
  const baseEnabled = intclawCfg?.enabled !== false;

  // Merge configs
  const merged = mergeIntclawAccountConfig(params.cfg, accountId);

  // Account-level enabled state
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;

  // Resolve credentials from merged config
  const creds = resolveIntclawCredentials(merged);
  const accountName = (merged as IntclawAccountConfig).name;

  return {
    accountId,
    selectionSource,
    enabled,
    configured: Boolean(creds),
    name: typeof accountName === "string" ? accountName.trim() || undefined : undefined,
    clientId: creds?.clientId,
    clientSecret: creds?.clientSecret,
    config: merged,
  };
}

/**
 * List all enabled and configured accounts.
 */
export function listEnabledIntclawAccounts(cfg: ClawdbotConfig): ResolvedIntclawAccount[] {
  return listIntclawAccountIds(cfg)
    .map((accountId) => resolveIntclawAccount({ cfg, accountId }))
    .filter((account) => account.enabled && account.configured);
}
