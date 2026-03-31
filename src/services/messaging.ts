/**
 * IntClaw消息发送模块
 * 支持 AI Card 流式响应、普通消息、主动消息
 */

import type { IntclawConfig } from "../types/index.ts";
import { INTCLAW_API, getAccessToken, getOapiAccessToken } from "../utils/index.ts";
import { intclawHttp, intclawOapiHttp } from "../utils/http-client.ts";
import { createLoggerFromConfig } from "../utils/logger.ts";
import {
  processLocalImages,
  processVideoMarkers,
  processAudioMarkers,
  processFileMarkers,
  uploadMediaToIntClaw,
} from "./media.ts";
import { sendViaWSAdapter } from "./messaging/ws-out-adapter.ts";

// ============ 常量 ============
// 注意：AI Card 相关的类型和函数已移至 ./messaging/card.ts，通过上方 import 引入

/** 消息类型枚举 */
export type IntClawMsgType =
  | "text"
  | "markdown"
  | "link"
  | "actionCard"
  | "image";

/** 主动发送消息的结果 */
export interface SendResult {
  ok: boolean;
  processQueryKey?: string;
  error?: string;
}

/** 主动发送选项 */
export interface ProactiveSendOptions {
  msgType?: IntClawMsgType;
  replyToId?: string;
  title?: string;
  log?: any;
}

// ============ 普通消息发送 ============

/**
 * 发送 Markdown 消息
 */
export async function sendMarkdownMessage(
  config: IntclawConfig,
  sessionWebhook: string,
  title: string,
  markdown: string,
  options: any = {},
): Promise<any> {
  const log = options.log || createLoggerFromConfig(config, 'IntClaw:Send');
  let text = markdown;
  if (options.atUserId) text = `${text} @${options.atUserId}`;

  const body: any = {
    msgtype: "markdown",
    markdown: { title: title || "Message", text },
  };
  if (options.atUserId)
    body.at = { atUserIds: [options.atUserId], isAtAll: false };

  // ✅ 强制使用 WebSocket 发送（移除 webhook fallback）
  if (options.accountId && options.conversationId) {
    log.info(`[WS-Markdown] 准备通过 WebSocket 发送 Markdown 消息: accountId=${options.accountId}, conversationId=${options.conversationId}, title="${title}", markdown_length=${markdown.length}`);

    const wsSuccess = await sendViaWSAdapter(
      options.accountId,
      { conversationId: options.conversationId },
      body,
      { log }
    );

    if (wsSuccess) {
      log.info(`[WS-Markdown] ✅ WebSocket 发送成功`);
      return { ok: true, viaWS: true };
    } else {
      log.error(`[WS-Markdown] ❌ WebSocket 发送失败，且 webhook 已禁用`);
      return { ok: false, error: 'WebSocket send failed and webhook is disabled' };
    }
  }

  log.error(`[WS-Markdown] ❌ 缺少必要参数 (accountId=${options.accountId}, conversationId=${options.conversationId})，无法发送消息`);
  return { ok: false, error: 'Missing accountId or conversationId for WebSocket send' };
}

/**
 * 发送文本消息
 */
export async function sendTextMessage(
  config: IntclawConfig,
  sessionWebhook: string,
  text: string,
  options: any = {},
): Promise<any> {
  const log = options.log || createLoggerFromConfig(config, 'IntClaw:Send');
  const body: any = { msgtype: "text", text: { content: text } };
  if (options.atUserId)
    body.at = { atUserIds: [options.atUserId], isAtAll: false };

  // ✅ 强制使用 WebSocket 发送（移除 webhook fallback）
  if (options.accountId && options.conversationId) {
    log.info(`[WS-Text] 准备通过 WebSocket 发送文本消息: accountId=${options.accountId}, conversationId=${options.conversationId}, text="${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);

    const wsSuccess = await sendViaWSAdapter(
      options.accountId,
      { conversationId: options.conversationId },
      body,
      { log }
    );

    if (wsSuccess) {
      log.info(`[WS-Text] ✅ WebSocket 发送成功`);
      return { ok: true, viaWS: true };
    } else {
      log.error(`[WS-Text] ❌ WebSocket 发送失败，且 webhook 已禁用`);
      return { ok: false, error: 'WebSocket send failed and webhook is disabled' };
    }
  }

  log.error(`[WS-Text] ❌ 缺少必要参数 (accountId=${options.accountId}, conversationId=${options.conversationId})，无法发送消息`);
  return { ok: false, error: 'Missing accountId or conversationId for WebSocket send' };
}

/**
 * 智能选择 text / markdown
 */
export async function sendMessage(
  config: IntclawConfig,
  sessionWebhook: string,
  text: string,
  options: any = {},
): Promise<any> {
  const hasMarkdown =
    /^[#*>-]|[*_`#\[\]]/.test(text) ||
    (text && typeof text === "string" && text.includes("\n"));
  const useMarkdown =
    options.useMarkdown !== false && (options.useMarkdown || hasMarkdown);

  if (useMarkdown) {
    const title =
      options.title ||
      text
        .split("\n")[0]
        .replace(/^[#*\s\->]+/, "")
        .slice(0, 20) ||
      "Message";
    return sendMarkdownMessage(config, sessionWebhook, title, text, options);
  }
  return sendTextMessage(config, sessionWebhook, text, options);
}

// ============ 主动发送消息 ============

/**
 * 构建普通消息的 msgKey 和 msgParam
 */
export function buildMsgPayload(
  msgType: IntClawMsgType,
  content: string,
  title?: string,
): { msgKey: string; msgParam: Record<string, any> } | { error: string } {
  switch (msgType) {
    case "markdown":
      return {
        msgKey: "sampleMarkdown",
        msgParam: {
          title:
            title ||
            content
              .split("\n")[0]
              .replace(/^[#*\s\->]+/, "")
              .slice(0, 20) ||
            "Message",
          text: content,
        },
      };
    case "link":
      try {
        return {
          msgKey: "sampleLink",
          msgParam: typeof content === "string" ? JSON.parse(content) : content,
        };
      } catch {
        return { error: "Invalid link message format, expected JSON" };
      }
    case "actionCard":
      try {
        return {
          msgKey: "sampleActionCard",
          msgParam: typeof content === "string" ? JSON.parse(content) : content,
        };
      } catch {
        return { error: "Invalid actionCard message format, expected JSON" };
      }
    case "image":
      return {
        msgKey: "sampleImageMsg",
        msgParam: { photoURL: content },
      };
    case "text":
    default:
      return {
        msgKey: "sampleText",
        msgParam: { content },
      };
  }
}

/**
 * 使用普通消息 API 发送单聊消息（降级方案）
 */
export async function sendNormalToUser(
  config: IntclawConfig,
  userIds: string | string[],
  content: string,
  options: ProactiveSendOptions = {},
): Promise<SendResult> {
  const { msgType = "text", title, log } = options;
  const userIdArray = Array.isArray(userIds) ? userIds : [userIds];

  const payload = buildMsgPayload(msgType, content, title);
  if ("error" in payload) {
    return { ok: false, error: payload.error };
  }

  try {
    const token = await getAccessToken(config);
    const body = {
      robotCode: config.clientId,
      userIds: userIdArray,
      msgKey: payload.msgKey,
      msgParam: JSON.stringify(payload.msgParam),
    };

    log?.info?.(
      `发送单聊消息: userIds=${userIdArray.join(",")}, msgType=${msgType}`,
    );

    const resp = await intclawHttp.post(
      `${INTCLAW_API}/v1.0/robot/oToMessages/batchSend`,
      body,
      {
        headers: {
          "x-acs-intclaw-access-token": token,
          "Content-Type": "application/json",
        },
        timeout: 10_000,
      },
    );

    if (resp.data?.processQueryKey) {
      log?.info?.(
        `发送成功: processQueryKey=${resp.data.processQueryKey}`,
      );
      return {
        ok: true,
        processQueryKey: resp.data.processQueryKey,
      };
    }

    log?.warn?.(
      `发送响应异常: ${JSON.stringify(resp.data)}`,
    );
    return {
      ok: false,
      error: resp.data?.message || "Unknown error",
    };
  } catch (err: any) {
    const errMsg = err.response?.data?.message || err.message;
    log?.error?.(`发送失败: ${errMsg}`);
    return { ok: false, error: errMsg };
  }
}

/**
 * 使用普通消息 API 发送群聊消息（降级方案）
 */
export async function sendNormalToGroup(
  config: IntclawConfig,
  openConversationId: string,
  content: string,
  options: ProactiveSendOptions = {},
): Promise<SendResult> {
  const { msgType = "text", title, log } = options;

  const payload = buildMsgPayload(msgType, content, title);
  if ("error" in payload) {
    return { ok: false, error: payload.error };
  }

  try {
    const token = await getAccessToken(config);
    const body = {
      robotCode: config.clientId,
      openConversationId,
      msgKey: payload.msgKey,
      msgParam: JSON.stringify(payload.msgParam),
    };

    log?.info?.(
      `发送群聊消息: openConversationId=${openConversationId}, msgType=${msgType}`,
    );

    const resp = await intclawHttp.post(
      `${INTCLAW_API}/v1.0/robot/groupMessages/send`,
      body,
      {
        headers: {
          "x-acs-intclaw-access-token": token,
          "Content-Type": "application/json",
        },
        timeout: 10_000,
      },
    );

    if (resp.data?.processQueryKey) {
      log?.info?.(
        `发送成功: processQueryKey=${resp.data.processQueryKey}`,
      );
      return {
        ok: true,
        processQueryKey: resp.data.processQueryKey,
      };
    }

    log?.warn?.(
      `发送响应异常: ${JSON.stringify(resp.data)}`,
    );
    return {
      ok: false,
      error: resp.data?.message || "Unknown error",
    };
  } catch (err: any) {
    const errMsg = err.response?.data?.message || err.message;
    log?.error?.(`发送失败: ${errMsg}`);
    return { ok: false, error: errMsg };
  }
}


/**
 * 主动发送文本消息到IntClaw
 */
export async function sendToUser(
  config: IntclawConfig,
  userId: string | string[],
  text: string,
  options?: ProactiveSendOptions,
): Promise<SendResult> {
  if (!config?.clientId || !config?.clientSecret) {
    return { ok: false, error: "Missing clientId or clientSecret" };
  }
  if (!userId || (Array.isArray(userId) && userId.length === 0)) {
    return { ok: false, error: "userId is empty" };
  }

  // 多用户：使用普通消息 API（不走 AI Card）
  if (Array.isArray(userId)) {
    return sendNormalToUser(config, userId, text, options || {});
  }

  return sendProactive(config, { userId }, text, options || {});
}

/**
 * 主动发送文本消息到IntClaw群
 */
export async function sendToGroup(
  config: IntclawConfig,
  openConversationId: string,
  text: string,
  options?: ProactiveSendOptions,
): Promise<SendResult> {
  if (!config?.clientId || !config?.clientSecret) {
    return { ok: false, error: "Missing clientId or clientSecret" };
  }
  if (!openConversationId || typeof openConversationId !== "string") {
    return { ok: false, error: "openConversationId is empty" };
  }
  return sendProactive(config, { openConversationId }, text, options || {});
}

/**
 * 发送文本消息（用于 outbound 接口）
 */
export async function sendTextToIntClaw(params: {
  config: IntclawConfig;
  target: string;
  text: string;
  replyToId?: string;
}): Promise<SendResult> {
  const { config, target, text, replyToId } = params;

  const log = createLoggerFromConfig(config, 'sendTextToIntClaw');

  // 参数校验
  if (!target || typeof target !== "string") {
    log.error("target 参数无效:", target);
    return { ok: false, error: "Invalid target parameter" };
  }

  // 判断目标是用户还是群
  const isUser = !target.startsWith("cid");
  const targetParam = isUser
    ? { type: "user" as const, userId: target }
    : { type: "group" as const, openConversationId: target };

  return sendProactive(config, targetParam, text, {
    msgType: "text",
    replyToId,
  });
}

/**
 * 发送媒体消息（用于 outbound 接口）
 */
export async function sendMediaToIntClaw(params: {
  config: IntclawConfig;
  target: string;
  text?: string;
  mediaUrl: string;
  replyToId?: string;
}): Promise<SendResult> {
  const log = createLoggerFromConfig(params.config, 'sendMediaToIntClaw');
  
  log.info(
    "开始处理，params:",
    JSON.stringify({
      target: params.target,
      text: params.text,
      mediaUrl: params.mediaUrl,
      replyToId: params.replyToId,
      hasConfig: !!params.config,
    }),
  );

  const { config, target, text, mediaUrl, replyToId } = params;

  // 参数校验
  if (!target || typeof target !== "string") {
    log.error("target 参数无效:", target);
    return { ok: false, error: "Invalid target parameter" };
  }

  // 判断目标是用户还是群
  const isUser = !target.startsWith("cid");
  const targetParam = isUser
    ? { type: "user" as const, userId: target }
    : { type: "group" as const, openConversationId: target };

  log.info("参数解析完成，mediaUrl:", mediaUrl, "type:", typeof mediaUrl);

  // 参数校验
  if (!mediaUrl) {
    log.info("mediaUrl 为空，返回错误提示");
    return sendProactive(config, targetParam, text ?? "⚠️ 缺少媒体文件 URL", {
      msgType: "text",
      replyToId,
    });
  }

  // 1. 先发送文本消息（如果有且不为空）
  // 注意：只有在 text 有实际内容时才发送，避免发送空消息
  if (text && text.trim().length > 0) {
    log.info("先发送文本消息:", text);
    await sendProactive(config, targetParam, text, {
      msgType: "text",
      replyToId,
    });
  }

  // 2. 上传媒体文件并发送媒体消息
  try {
    log.info("开始获取 oapiToken");
    const oapiToken = await getOapiAccessToken(config);
    log.info("oapiToken 获取成功");

    // 根据文件扩展名判断媒体类型
    log.info("开始解析文件扩展名，mediaUrl:", mediaUrl);
    const ext = mediaUrl.toLowerCase().split(".").pop() || "";
    log.info("文件扩展名:", ext);
    let mediaType: "image" | "file" | "video" | "voice" = "file";

    if (["jpg", "jpeg", "png", "gif", "bmp", "webp"].includes(ext)) {
      mediaType = "image";
    } else if (
      ["mp4", "avi", "mov", "mkv", "flv", "wmv", "webm"].includes(ext)
    ) {
      mediaType = "video";
    } else if (
      ["mp3", "wav", "aac", "ogg", "m4a", "flac", "wma", "amr"].includes(ext)
    ) {
      mediaType = "voice";
    }
    log.info("媒体类型判断完成:", mediaType);

    // 上传文件到IntClaw
    // 根据媒体类型设置不同的大小限制（IntClaw OAPI 官方限制）
    let maxSize: number;
    switch (mediaType) {
      case "image":
        maxSize = 10 * 1024 * 1024; // 图片最大 10MB
        break;
      case "voice":
        maxSize = 2 * 1024 * 1024; // 语音最大 2MB
        break;
      case "video":
      case "file":
        maxSize = 20 * 1024 * 1024; // 视频和文件最大 20MB
        break;
      default:
        maxSize = 20 * 1024 * 1024; // 默认 20MB
    }
    
    log.info("准备调用 uploadMediaToIntClaw，参数:", { mediaUrl, mediaType, maxSizeMB: (maxSize / (1024 * 1024)).toFixed(0) });
    if (!oapiToken) {
      log.error("oapiToken 为空，无法上传媒体文件");
      return sendProactive(
        config,
        targetParam,
        "⚠️ 媒体文件处理失败：缺少 oapiToken",
        { msgType: "text", replyToId },
      );
    }
    const uploadResult = await uploadMediaToIntClaw(
      mediaUrl,
      mediaType,
      oapiToken,
      maxSize,
      log,
    );
    log.info("uploadMediaToIntClaw 返回结果:", uploadResult);

    if (!uploadResult) {
      // 上传失败，发送文本消息提示
      log.error("上传失败，返回错误提示");
      return sendProactive(config, targetParam, "⚠️ 媒体文件上传失败", {
        msgType: "text",
        replyToId,
      });
    }

    // uploadResult 现在是对象，包含 mediaId、cleanMediaId、downloadUrl
    log.info("提取 media_id:", uploadResult.mediaId);

    // 3. 根据媒体类型发送对应的消息
    const fileName = mediaUrl.split("/").pop() || "file";

    if (mediaType === "image") {
      // 图片消息 - 发送真正的图片消息，使用原始 mediaId（带 @）
      const result = await sendProactive(config, targetParam, uploadResult.mediaId, {
        msgType: "image",
        replyToId,
      });
      return {
        ...result,
        processQueryKey: result.processQueryKey || "image-message-sent",
      };
    }

    // 对于视频，使用视频标记机制
    if (mediaType === "video") {
      // 构建视频标记
      const videoMarker = `[INTCLAW_VIDEO]{"path":"${mediaUrl}"}[/INTCLAW_VIDEO]`;

      // 直接处理视频标记（上传并发送视频消息）
      const { processVideoMarkers } = await import("./media.js");
      await processVideoMarkers(
        videoMarker, // 只传入标记，不包含原始文本
        "",
        config,
        oapiToken,
        console,
        true, // useProactiveApi
        targetParam,
      );

      // 如果有原始文本，单独发送
      if (text?.trim()) {
        const result = await sendProactive(config, targetParam, text, {
          msgType: "text",
          replyToId,
        });
        return {
          ...result,
          processQueryKey: result.processQueryKey || "video-text-sent",
        };
      }

      // 视频已发送，返回成功
      return {
        ok: true,
        processQueryKey: "video-message-sent",
      };
    }

    // 对于音频、文件，发送真正的文件消息
    const fs = await import("fs");
    const stats = fs.statSync(mediaUrl);
    
    // 获取文件扩展名作为 fileType
    const fileType = ext || "file";
    
    // 构建文件信息
    const fileInfo = {
      fileName: fileName,
      fileType: fileType,
    };

    // 使用 sendFileProactive 发送文件消息
    const { sendFileProactive } = await import("./media.ts");
    await sendFileProactive(config, targetParam, fileInfo, uploadResult.mediaId, log);

    // 返回成功结果
    return {
      ok: true,
      processQueryKey: "file-message-sent",
    };
  } catch (err: any) {
    log.error("发送媒体消息失败:", err.message);
    // 发生错误，发送文本消息提示
    return sendProactive(
      config,
      targetParam,
      `⚠️ 媒体文件处理失败: ${err.message}`,
      { msgType: "text", replyToId },
    );
  }
}

/**
 * 智能发送消息
 */
export async function sendProactive(
  config: IntclawConfig,
  target: { userId?: string; userIds?: string[]; openConversationId?: string },
  content: string,
  options: ProactiveSendOptions = {},
): Promise<SendResult> {
  const log = createLoggerFromConfig(config, 'sendProactive');
  
  log.info(
    "开始处理，参数:",
    JSON.stringify({
      target,
      contentLength: content?.length,
      hasOptions: !!options,
    }),
  );

  if (!options.msgType) {
    const hasMarkdown =
      /^[#*>-]|[*_`#\[\]]/.test(content) ||
      (content && typeof content === "string" && content.includes("\n"));
    if (hasMarkdown) {
      options.msgType = "markdown";
    }
  }

  // 直接实现发送逻辑，不要递归调用 sendToUser/sendToGroup
  if (target.userId || target.userIds) {
    const userIds = target.userIds || [target.userId!];
    const userId = userIds[0];
    log.info("发送给用户，userId:", userId);

    // 构建发送参数
    return sendProactiveInternal(
      config,
      { type: "user", userId },
      content,
      options,
    );
  }

  if (target.openConversationId) {
    log.info(
      "发送给群聊，openConversationId:",
      target.openConversationId,
    );
    return sendProactiveInternal(
      config,
      { type: "group", openConversationId: target.openConversationId },
      content,
      options,
    );
  }

  log.error("target 参数缺少必要字段:", target);
  return {
    ok: false,
    error: "Must specify userId, userIds, or openConversationId",
  };
}

/**
 * 内部发送实现
 */
async function sendProactiveInternal(
  config: IntclawConfig,
  target: { type: "user"; userId: string } | { type: "group"; openConversationId: string },
  content: string,
  options: ProactiveSendOptions,
): Promise<SendResult> {
  const log = createLoggerFromConfig(config, 'sendProactiveInternal');
  
  log.info(
    "开始处理，参数:",
    JSON.stringify({
      target,
      contentLength: content?.length,
      msgType: options.msgType,
      targetType: target?.type,
      hasTarget: !!target,
    }),
  );

  // 参数校验
  if (!target || typeof target !== "object") {
    log.error("target 参数无效:", target);
    return { ok: false, error: "Invalid target parameter" };
  }

  const {
    msgType = "text",
    log: externalLog,
  } = options;

  // 发送普通消息
  try {
    log.info(
      "准备发送普通消息，target.type:",
      target.type,
    );
    const token = await getAccessToken(config);
    const isUser = target.type === "user";
    log.info(
      "isUser:",
      isUser,
      "target:",
      JSON.stringify(target),
    );
    const targetId = isUser ? target.userId : target.openConversationId;
    log.info("targetId:", targetId);

    // ✅ 根据目标类型选择不同的 API
    const webhookUrl = isUser
      ? `${INTCLAW_API}/v1.0/robot/oToMessages/batchSend`
      : `${INTCLAW_API}/v1.0/robot/groupMessages/send`;

    // 使用 buildMsgPayload 构建消息体（支持所有消息类型）
    const payload = buildMsgPayload(msgType, content, options.title);
    if ("error" in payload) {
      log.error("构建消息失败:", payload.error);
      return { ok: false, error: payload.error };
    }

    const body: any = {
      robotCode: config.clientId,
      msgKey: payload.msgKey,
      msgParam: JSON.stringify(payload.msgParam),
    };

    // ✅ 根据目标类型设置不同的参数
    if (isUser) {
      body.userIds = [targetId];
    } else {
      body.openConversationId = targetId;
    }

    externalLog?.info?.(
      `发送${isUser ? '单聊' : '群聊'}消息：${isUser ? 'userIds=' : 'openConversationId='}${targetId}`,
    );

    const resp = await intclawHttp.post(webhookUrl, body, {
      headers: {
        "x-acs-intclaw-access-token": token,
        "Content-Type": "application/json",
      },
    });

    // 重要：IntClaw接口有时会出现 HTTP 200 但业务失败的情况，需要打印返回体辅助排查
    try {
      const dataPreview = JSON.stringify(resp.data ?? {});
      const truncated =
        dataPreview.length > 2000 ? `${dataPreview.slice(0, 2000)}...(truncated)` : dataPreview;
      const msg = `发送${isUser ? "单聊" : "群聊"}消息响应：status=${resp.status}, processQueryKey=${resp.data?.processQueryKey ?? ""}, data=${truncated}`;
      log.info(msg);
      externalLog?.info?.(msg);
    } catch {
      const msg = `发送${isUser ? "单聊" : "群聊"}消息响应：status=${resp.status}, processQueryKey=${resp.data?.processQueryKey ?? ""}`;
      log.info(msg);
      externalLog?.info?.(msg);
    }

    return {
      ok: true,
      processQueryKey: resp.data?.processQueryKey,
    };
  } catch (err: any) {
    const status = err?.response?.status;
    const respData = err?.response?.data;
    let respPreview = "";
    try {
      const raw = JSON.stringify(respData ?? {});
      respPreview = raw.length > 2000 ? `${raw.slice(0, 2000)}...(truncated)` : raw;
    } catch {
      respPreview = String(respData ?? "");
    }

    const baseMsg = err?.message ? String(err.message) : String(err);
    const extra =
      typeof status === "number"
        ? ` status=${status}${respPreview ? `, data=${respPreview}` : ""}`
        : respPreview
          ? ` data=${respPreview}`
          : "";

    const msg = `发送${target.type === "user" ? "单聊" : "群聊"}消息失败：${baseMsg}${extra}`;
    log.error(msg);
    externalLog?.error?.(msg);
    return { ok: false, error: baseMsg };
  }
}
