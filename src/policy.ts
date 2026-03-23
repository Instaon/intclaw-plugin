import type { ToolPolicy } from "openclaw/plugin-sdk";
import type { ResolvedIntclawAccount } from "./types/index.ts";

export function resolveIntclawGroupToolPolicy(params: {
  account: ResolvedIntclawAccount;
  groupId: string;
}): ToolPolicy | undefined {
  const { account, groupId } = params;
  const intclawCfg = account.config;

  // Check group-specific policy first
  const groupConfig = intclawCfg?.groups?.[groupId];
  if (groupConfig?.tools) {
    return groupConfig.tools;
  }

  // Fall back to account-level default (allow all)
  return { allow: ["*"] };
}
