import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingDmPolicy,
  ClawdbotConfig,
  DmPolicy,
  SecretInput,
  WizardPrompter,
} from "openclaw/plugin-sdk";
import {
  addWildcardAllowFrom,
  DEFAULT_ACCOUNT_ID,
  formatDocsLink,
  hasConfiguredSecretInput,
} from "./sdk/helpers.ts";
import { promptSingleChannelSecretInput } from "openclaw/plugin-sdk";
import { resolveIntclawCredentials } from "./config/accounts.ts";
import { probeIntclaw } from "./probe.ts";
import type { IntclawConfig } from "./types/index.ts";

const channel = "intclaw-connector" as const;

function normalizeString(value: unknown): string | undefined {
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function setIntclawDmPolicy(cfg: ClawdbotConfig, dmPolicy: DmPolicy): ClawdbotConfig {
  const allowFrom =
    dmPolicy === "open"
      ? addWildcardAllowFrom(cfg.channels?.["intclaw-connector"]?.allowFrom)?.map((entry) => String(entry))
      : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      "intclaw-connector": {
        ...cfg.channels?.["intclaw-connector"],
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

function setIntclawAllowFrom(cfg: ClawdbotConfig, allowFrom: string[]): ClawdbotConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      "intclaw-connector": {
        ...cfg.channels?.["intclaw-connector"],
        allowFrom,
      },
    },
  };
}

function parseAllowFromInput(raw: string): string[] {
  return raw
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function promptIntclawAllowFrom(params: {
  cfg: ClawdbotConfig;
  prompter: WizardPrompter;
}): Promise<ClawdbotConfig> {
  const existing = params.cfg.channels?.["intclaw-connector"]?.allowFrom ?? [];
  await params.prompter.note(
    [
      "Allowlist IntClaw DMs by user ID.",
      "You can find user ID in IntClaw admin console or via API.",
      "Examples:",
      "- user123456",
      "- user789012",
    ].join("\n"),
    "IntClaw allowlist",
  );

  while (true) {
    const entry = await params.prompter.text({
      message: "IntClaw allowFrom (user IDs)",
      placeholder: "user123456, user789012",
      initialValue: existing[0] ? String(existing[0]) : undefined,
      validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
    });
    const parts = parseAllowFromInput(String(entry));
    if (parts.length === 0) {
      await params.prompter.note("Enter at least one user.", "IntClaw allowlist");
      continue;
    }

    const unique = [
      ...new Set([
        ...existing.map((v: string | number) => String(v).trim()).filter(Boolean),
        ...parts,
      ]),
    ];
    return setIntclawAllowFrom(params.cfg, unique);
  }
}

async function noteIntclawCredentialHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "1) Go to IntClaw Open Platform (open-dev.intclaw.com)",
      "2) Create an enterprise internal app",
      "3) Get App Key (Client ID) and App Secret (Client Secret) from Credentials page",
      "4) Enable required permissions: im:message, im:chat",
      "5) Publish the app or add it to a test group",
      "Tip: you can also set INTCLAW_CLIENT_ID / INTCLAW_CLIENT_SECRET env vars.",
      `Docs: ${formatDocsLink("/channels/intclaw-connector", "intclaw-connector")}`,
    ].join("\n"),
    "IntClaw credentials",
  );
}

async function promptIntclawClientId(params: {
  prompter: WizardPrompter;
  initialValue?: string;
}): Promise<string> {
  const clientId = String(
    await params.prompter.text({
      message: "Enter IntClaw App Key (Client ID)",
      initialValue: params.initialValue,
      validate: (value) => (value?.trim() ? undefined : "Required"),
    }),
  ).trim();
  return clientId;
}

function setIntclawGroupPolicy(
  cfg: ClawdbotConfig,
  groupPolicy: "open" | "allowlist" | "disabled",
): ClawdbotConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      "intclaw-connector": {
        ...cfg.channels?.["intclaw-connector"],
        enabled: true,
        groupPolicy,
      },
    },
  };
}

function setIntclawGroupAllowFrom(cfg: ClawdbotConfig, groupAllowFrom: string[]): ClawdbotConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      "intclaw-connector": {
        ...cfg.channels?.["intclaw-connector"],
        groupAllowFrom,
      },
    },
  };
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "IntClaw",
  channel,
  policyKey: "channels.intclaw-connector.dmPolicy",
  allowFromKey: "channels.intclaw-connector.allowFrom",
  getCurrent: (cfg) => (cfg.channels?.["intclaw-connector"] as IntclawConfig | undefined)?.dmPolicy ?? "open",
  setPolicy: (cfg, policy) => setIntclawDmPolicy(cfg, policy),
  promptAllowFrom: promptIntclawAllowFrom,
};

function addYintaiSkillConfig(
  cfg: ClawdbotConfig,
  clientId: string,
  clientSecret: string,
): ClawdbotConfig {
  return {
    ...cfg,
    skills: {
      ...cfg.skills,
      entries: {
        ...cfg.skills?.entries,
        yintai_tasks_runner: {
          enabled: true,
          apiKey: clientId,
          env: {
            YINTAI_APP_SECRET: clientSecret,
          },
        },
      },
    },
  };
}

export const intclawOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const intclawCfg = cfg.channels?.["intclaw-connector"] as IntclawConfig | undefined;

    const isClientIdConfigured = (value: unknown): boolean => {
      const asString = normalizeString(value);
      if (asString) {
        return true;
      }
      if (!value || typeof value !== "object") {
        return false;
      }
      const rec = value as Record<string, unknown>;
      const source = normalizeString(rec.source)?.toLowerCase();
      const id = normalizeString(rec.id);
      if (source === "env" && id) {
        return Boolean(normalizeString(process.env[id]));
      }
      return hasConfiguredSecretInput(value);
    };

    const topLevelConfigured = Boolean(
      isClientIdConfigured(intclawCfg?.clientId) && hasConfiguredSecretInput(intclawCfg?.clientSecret),
    );

    const accountConfigured = Object.values(intclawCfg?.accounts ?? {}).some((account) => {
      if (!account || typeof account !== "object") {
        return false;
      }
      const hasOwnClientId = Object.prototype.hasOwnProperty.call(account, "clientId");
      const hasOwnClientSecret = Object.prototype.hasOwnProperty.call(account, "clientSecret");
      const accountClientIdConfigured = hasOwnClientId
        ? isClientIdConfigured((account as Record<string, unknown>).clientId)
        : isClientIdConfigured(intclawCfg?.clientId);
      const accountSecretConfigured = hasOwnClientSecret
        ? hasConfiguredSecretInput((account as Record<string, unknown>).clientSecret)
        : hasConfiguredSecretInput(intclawCfg?.clientSecret);
      return Boolean(accountClientIdConfigured && accountSecretConfigured);
    });

    const configured = topLevelConfigured || accountConfigured;
    const resolvedCredentials = resolveIntclawCredentials(intclawCfg, {
      allowUnresolvedSecretRef: true,
    });

    // Try to probe if configured
    let probeResult = null;
    if (configured && resolvedCredentials) {
      try {
        probeResult = await probeIntclaw(resolvedCredentials);
      } catch {
        // Ignore probe errors
      }
    }

    const statusLines: string[] = [];
    if (!configured) {
      statusLines.push("IntClaw: needs app credentials");
    } else if (probeResult?.ok) {
      statusLines.push(
        `IntClaw: connected as ${probeResult.botName ?? "bot"}`,
      );
    } else {
      statusLines.push("IntClaw: configured (connection not verified)");
    }

    return {
      channel,
      configured,
      statusLines,
      selectionHint: configured ? "configured" : "needs app creds",
      quickstartScore: configured ? 2 : 0,
    };
  },

  configure: async ({ cfg, prompter }) => {
    const intclawCfg = cfg.channels?.["intclaw-connector"] as IntclawConfig | undefined;
    const resolved = resolveIntclawCredentials(intclawCfg, {
      allowUnresolvedSecretRef: true,
    });
    const hasConfigSecret = hasConfiguredSecretInput(intclawCfg?.clientSecret);
    const hasConfigCreds = Boolean(
      typeof intclawCfg?.clientId === "string" && intclawCfg.clientId.trim() && hasConfigSecret,
    );
    const canUseEnv = Boolean(
      !hasConfigCreds && process.env.INTCLAW_CLIENT_ID?.trim() && process.env.INTCLAW_CLIENT_SECRET?.trim(),
    );

    let next = cfg;
    let clientId: string | null = null;
    let clientSecret: SecretInput | null = null;
    let clientSecretProbeValue: string | null = null;

    if (!resolved) {
      await noteIntclawCredentialHelp(prompter);
    }

    const clientSecretResult = await promptSingleChannelSecretInput({
      cfg: next,
      prompter,
      providerHint: "intclaw",
      credentialLabel: "App Secret (Client Secret)",
      accountConfigured: Boolean(resolved),
      canUseEnv,
      hasConfigToken: hasConfigSecret,
      envPrompt: "INTCLAW_CLIENT_ID + INTCLAW_CLIENT_SECRET detected. Use env vars?",
      keepPrompt: "IntClaw App Secret already configured. Keep it?",
      inputPrompt: "Enter IntClaw App Secret (Client Secret)",
      preferredEnvVar: "INTCLAW_CLIENT_SECRET",
    });

    if (clientSecretResult.action === "use-env") {
      next = {
        ...next,
        channels: {
          ...next.channels,
          "intclaw-connector": { ...next.channels?.["intclaw-connector"], enabled: true },
        },
      };
      // Set clientId and clientSecret for connection test and skill config
      clientId = process.env.INTCLAW_CLIENT_ID?.trim() ?? null;
      clientSecretProbeValue = process.env.INTCLAW_CLIENT_SECRET?.trim() ?? null;
      // Set clientSecret to a truthy value so the condition check passes
      clientSecret = { source: "env", id: "INTCLAW_CLIENT_SECRET" };
    } else if (clientSecretResult.action === "set") {
      clientSecret = clientSecretResult.value;
      clientSecretProbeValue = clientSecretResult.resolvedValue;
      clientId = await promptIntclawClientId({
        prompter,
        initialValue:
          normalizeString(intclawCfg?.clientId) ?? normalizeString(process.env.INTCLAW_CLIENT_ID),
      });
    } else if (clientSecretResult.action === "keep") {
      // Keep existing configuration - set variables for connection test and skill config
      const existingResolved = resolveIntclawCredentials(intclawCfg, { allowUnresolvedSecretRef: false });
      if (existingResolved) {
        clientId = existingResolved.clientId ?? null;
        clientSecretProbeValue = existingResolved.clientSecret ?? null;
        clientSecret = intclawCfg?.clientSecret ?? null;
      }
    }

    if (clientId && clientSecret) {
      next = {
        ...next,
        channels: {
          ...next.channels,
          "intclaw-connector": {
            ...next.channels?.["intclaw-connector"],
            enabled: true,
            clientId,
            clientSecret,
          },
        },
      };

      // Test connection
      try {
        const probe = await probeIntclaw({
          clientId,
          clientSecret: clientSecretProbeValue ?? undefined,
        });
        if (probe.ok) {
          await prompter.note(
            `Connected as ${probe.botName ?? "bot"}`,
            "IntClaw connection test",
          );
          // Add yintai_tasks_runner skill configuration
          next = addYintaiSkillConfig(next, clientId, clientSecretProbeValue ?? clientSecret);
          await prompter.note(
            `Added yintai_tasks_runner skill configuration:\n  apiKey: ${clientId}\n  env.YINTAI_APP_SECRET: ${clientSecretProbeValue ?? clientSecret}`,
            "IntClaw skill config",
          );
        } else {
          await prompter.note(
            `Connection failed: ${probe.error ?? "unknown error"}`,
            "IntClaw connection test",
          );
        }
      } catch (err) {
        await prompter.note(`Connection test failed: ${String(err)}`, "IntClaw connection test");
      }
    }

    // Group policy
    const groupPolicy = await prompter.select({
      message: "Group chat policy",
      options: [
        { value: "allowlist", label: "Allowlist - only respond in specific groups" },
        { value: "open", label: "Open - respond in all groups (requires mention)" },
        { value: "disabled", label: "Disabled - don't respond in groups" },
      ],
      initialValue: (next.channels?.["intclaw-connector"] as IntclawConfig | undefined)?.groupPolicy ?? "open",
    });
    if (groupPolicy) {
      next = setIntclawGroupPolicy(next, groupPolicy as "open" | "allowlist" | "disabled");
    }

    // Group allowlist if needed
    if (groupPolicy === "allowlist") {
      const existing = (next.channels?.["intclaw-connector"] as IntclawConfig | undefined)?.groupAllowFrom ?? [];
      const entry = await prompter.text({
        message: "Group chat allowlist (conversation IDs)",
        placeholder: "cidxxxx, cidyyyy",
        initialValue: existing.length > 0 ? existing.map(String).join(", ") : undefined,
      });
      if (entry) {
        const parts = parseAllowFromInput(String(entry));
        if (parts.length > 0) {
          next = setIntclawGroupAllowFrom(next, parts);
        }
      }
    }

    return { cfg: next, accountId: DEFAULT_ACCOUNT_ID };
  },

  dmPolicy,

  disable: (cfg) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      "intclaw-connector": { ...cfg.channels?.["intclaw-connector"], enabled: false },
    },
  }),
};
