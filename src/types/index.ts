import type { BaseProbeResult } from "openclaw/plugin-sdk";
import type {
  IntclawConfigSchema,
  IntclawGroupSchema,
  IntclawAccountConfigSchema,
  z,
} from "../config/schema.ts";

export type IntclawConfig = z.infer<typeof IntclawConfigSchema>;
export type IntclawGroupConfig = z.infer<typeof IntclawGroupSchema>;
export type IntclawAccountConfig = z.infer<typeof IntclawAccountConfigSchema>;

export type IntclawConnectionMode = "stream";

export type IntclawDefaultAccountSelectionSource =
  | "explicit-default"
  | "mapped-default"
  | "fallback";
export type IntclawAccountSelectionSource = "explicit" | IntclawDefaultAccountSelectionSource;

export type ResolvedIntclawAccount = {
  accountId: string;
  selectionSource: IntclawAccountSelectionSource;
  enabled: boolean;
  configured: boolean;
  name?: string;
  clientId?: string;
  clientSecret?: string;
  /** Merged config (top-level defaults + account-specific overrides) */
  config: IntclawConfig;
};

export type IntclawMessageContext = {
  conversationId: string;
  messageId: string;
  senderId: string;
  senderName?: string;
  conversationType: "1" | "2"; // 1=单聊, 2=群聊
  content: string;
  contentType: string;
  groupSubject?: string;
};

export type IntclawSendResult = {
  messageId: string;
  conversationId: string;
};

export type IntclawProbeResult = BaseProbeResult<string> & {
  clientId?: string;
  botName?: string;
};
