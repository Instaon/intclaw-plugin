import type {
  ClawdbotConfig,
  RuntimeEnv,
  ReplyPayload,
} from "openclaw/plugin-sdk";
import {
  createReplyPrefixOptions,
  createTypingCallbacks,
  logTypingFailure,
} from "openclaw/plugin-sdk";
import { resolveIntclawAccount } from "./config/accounts.ts";
import { getIntclawRuntime } from "./runtime.ts";
import type { IntclawConfig } from "./types/index.ts";
import { sendViaWSAdapter } from "./services/messaging/ws-out-adapter.ts";
import {
  processLocalImages,
  processVideoMarkers,
  processAudioMarkers,
  processFileMarkers,
} from "./services/media/index.ts";
import { getAccessToken, getOapiAccessToken } from "./utils/index.ts";

// ============ 新会话命令归一化 ============

/** 新会话触发命令 */
const NEW_SESSION_COMMANDS = ['/new', '/reset', '/clear', '新会话', '重新开始', '清空对话'];

/**
 * 将新会话命令归一化为标准的 /new 命令
 * 支持多种别名：/new、/reset、/clear、新会话、重新开始、清空对话
 */
export function normalizeSlashCommand(text: string): string {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (NEW_SESSION_COMMANDS.some(cmd => lower === cmd.toLowerCase())) {
    return '/new';
  }
  return text;
}

export type CreateIntclawReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  conversationId: string;
  senderId: string;
  isDirect: boolean;
  accountId?: string;
  messageCreateTimeMs?: number;
  sessionWebhook: string;
  asyncMode?: boolean;
};

export function createIntclawReplyDispatcher(params: CreateIntclawReplyDispatcherParams) {
  const core = getIntclawRuntime();
  const {
    cfg,
    agentId,
    conversationId,
    senderId,
    isDirect,
    accountId,
    sessionWebhook,
    asyncMode = false,
  } = params;

  const account = resolveIntclawAccount({ cfg, accountId });
  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg,
    agentId,
    channel: "intclaw-connector",
    accountId,
  });

  // ✅ 读取 debug 配置
  const debugMode = account.config?.debug || false;
  const log = {
    info: (msg: string) => {
      if (debugMode) {
        params.runtime.info?.(msg);
      }
    },
    error: (msg: string) => {
      if (debugMode) {
        params.runtime.error?.(msg);
      }
    },
    warn: (msg: string) => {
      if (debugMode) {
        params.runtime.warn?.(msg);
      }
    },
    debug: (msg: string) => {
      if (debugMode) {
        params.runtime.debug?.(msg);
      }
    },
  };

  // 流式响应状态管理
  const deliveredFinalTexts = new Set<string>();
  
  // 异步模式：累积完整响应
  let asyncModeFullResponse = "";
  
  // 节流控制：避免频繁发送导致问题
  let lastUpdateTime = 0;
  const updateInterval = 1000; // 最小更新间隔 1000ms

  // ✅ 错误兜底：防止重复发送错误消息
  const deliveredErrorTypes = new Set<string>();
  let lastErrorTime = 0;
  const ERROR_COOLDOWN = 60000; // 错误消息冷却时间 1 分钟

  // ============ 错误兜底函数 ============

  /**
   * 发送兜底错误消息，确保用户始终能收到反馈
   */
  const sendFallbackErrorMessage = async (
    errorType: 'mediaProcess' | 'sendMessage' | 'unknown',
    originalError?: string,
    forceSend: boolean = false
  ) => {
    const now = Date.now();
    const errorKey = `${errorType}:${conversationId}:${senderId}`;
    
    // 防止重复发送相同类型的错误消息
    if (!forceSend && deliveredErrorTypes.has(errorKey)) {
      log.debug(`[IntClaw][Fallback] 跳过重复错误消息：${errorType}`);
      return;
    }
    
    // 冷却时间控制
    if (!forceSend && now - lastErrorTime < ERROR_COOLDOWN) {
      log.debug(`[IntClaw][Fallback] 冷却时间内，跳过错误消息`);
      return;
    }

    const errorMessages = {
      mediaProcess: '⚠️ 媒体文件处理失败，已发送文字回复',
      sendMessage: '⚠️ 消息发送失败，请稍后重试',
      unknown: '⚠️ 抱歉，处理您的请求时出错，请稍后重试',
    };
    
    const errorMessage = errorMessages[errorType];
    log.warn(`[IntClaw][Fallback] ${errorMessage}, error: ${originalError}`);
    
    try {
      await sendMessage(
        account.config as IntclawConfig,
        sessionWebhook,
        errorMessage,
        {
          useMarkdown: false,
          log: params.runtime.log,
        }
      );
      deliveredErrorTypes.add(errorKey);
      lastErrorTime = now;
      log.info(`[IntClaw][Fallback] ✅ 错误消息发送成功`);
    } catch (fallbackErr: any) {
      log.error(`[IntClaw][Fallback] ❌ 错误消息发送失败：${fallbackErr.message}`);
    }
  };

  // 打字指示器回调（IntClaw暂不支持，预留接口）
  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      // IntClaw暂不支持打字指示器
    },
    stop: async () => {
      // IntClaw暂不支持打字指示器
    },
    onStartError: (err) =>
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "intclaw-connector",
        action: "start",
        error: err,
      }),
    onStopError: (err) =>
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "intclaw-connector",
        action: "stop",
        error: err,
      }),
  });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit(
    cfg,
    "intclaw-connector",
    accountId,
    { fallbackLimit: 4000 }
  );
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "intclaw-connector");

  // WebSocket 流式响应支持
  const streamingEnabled = account.config?.streaming !== false;

  // WebSocket 流式发送：发送 response.in_progress 事件
  const startStreaming = async () => {
    if (!streamingEnabled) {
      log.info(`[WS-Streaming] 流式功能被禁用`);
      return;
    }

    log.info(`[WS-Streaming] 开始发送 response.in_progress 事件`);

    try {
      const target = { conversationId: conversationId };
      await sendViaWSAdapter(accountId, target, {
        msgtype: 'markdown',  // 用于内容格式化
        markdown: {
          content: ''  // 初始为空
        }
      }, { log: params.runtime.log });

      log.info(`[WS-Streaming] ✅ response.in_progress 发送成功`);
    } catch (error: any) {
      log.error(`[WS-Streaming] ❌ 发送 response.in_progress 失败：${error?.message}`);
    }
  };

  // WebSocket 流式发送：发送 response.completed 事件
  const closeStreaming = async (finalText?: string) => {
    if (!streamingEnabled) {
      return;
    }

    const text = finalText || '✅ 任务执行完成';
    log.info(`[WS-Streaming] 发送 response.completed 事件，文本长度=${text.length}`);

    try {
      const target = { conversationId: conversationId };
      await sendViaWSAdapter(accountId, target, {
        msgtype: 'markdown',
        markdown: {
          content: text
        }
      }, { log: params.runtime.log });

      log.info(`[WS-Streaming] ✅ response.completed 发送成功`);
    } catch (error: any) {
      log.error(`[WS-Streaming] ❌ 发送 response.completed 失败：${error?.message}`);
    }
  };

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      ...prefixOptions,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: async () => {
        deliveredFinalTexts.clear();
        log.info(`[IntClaw][onReplyStart] 开始回复，流式 enabled=${streamingEnabled}`);
        if (streamingEnabled) {
          await startStreaming();
        }
        typingCallbacks.onActive?.();
      },
      deliver: async (payload, info) => {
        let text = payload.text ?? "";
        
        log.info(`[IntClaw][deliver] 被调用：kind=${info?.kind}, textLength=${text.length}, hasText=${Boolean(text.trim())}`);
        
        // ✅ 在 final 响应时，处理媒体文件
        if (info?.kind === "final" && text.trim()) {
          try {
            const oapiToken = await getOapiAccessToken(account.config as IntclawConfig);
            if (oapiToken) {
              log.info(`[IntClaw][deliver] 检测到 final 响应，准备处理媒体文件`);
              const { processRawMediaPaths } = await import('./services/media.js');
              text = await processRawMediaPaths(
                text,
                account.config as IntclawConfig,
                oapiToken,
                log,
                { type: isDirect ? 'user' : 'group', ...(isDirect ? { userId: senderId } : { openConversationId: conversationId }) }
              );
              log.info(`[IntClaw][deliver] 媒体文件处理完成`);
            }
          } catch (err: any) {
            log.error(`[IntClaw][deliver] 处理媒体文件失败：${err.message}`);
          }
        }
        
        const hasText = Boolean(text.trim());
        const skipTextForDuplicateFinal =
          info?.kind === "final" && hasText && deliveredFinalTexts.has(text);
        
        // ✅ 如果是 final 响应且没有文本，使用默认提示文案
        if (info?.kind === "final" && !hasText) {
          text = '✅ 任务执行完成（无文本输出）';
          log.info(`[IntClaw][deliver] final 响应无文本，使用默认提示文案`);
        }
        
        const shouldDeliverText = Boolean(text.trim()) && !skipTextForDuplicateFinal;

        if (!shouldDeliverText) {
          log.info(`[IntClaw][deliver] 跳过发送：hasText=${hasText}, skipTextForDuplicateFinal=${skipTextForDuplicateFinal}`);
          return;
        }

        // 异步模式：只累积响应，不发送
        if (asyncMode) {
          log.info(`[IntClaw][deliver] 异步模式，累积响应`);
          asyncModeFullResponse = text;
          return;
        }

        // WebSocket 流式模式：发送 response.output_text.delta 事件
        if (info?.kind === "block" && streamingEnabled) {
          log.info(`[WS-Streaming] 发送 response.output_text.delta 事件，文本长度=${text.length}`);
          try {
            const target = { conversationId: conversationId };
            await sendViaWSAdapter(accountId, target, {
              msgtype: 'text',
              text: { content: text }
            }, { log: params.runtime.log });
            log.info(`[WS-Streaming] ✅ response.output_text.delta 发送成功`);
          } catch (wsErr: any) {
            log.error(`[WS-Streaming] ❌ 发送 response.output_text.delta 失败：${wsErr.message}`);
            // 降级到普通消息
            await sendMessage(
              account.config as IntclawConfig,
              sessionWebhook,
              text,
              { useMarkdown: true, log: params.runtime.log }
            );
          }
          deliveredFinalTexts.add(text);
          return;
        }

        // WebSocket 流式模式的 final 处理
        if (info?.kind === "final" && streamingEnabled) {
          log.info(`[WS-Streaming] final 响应，发送 response.completed 事件`);
          await closeStreaming(text);
          deliveredFinalTexts.add(text);
          return;
        }

        // 流式模式但没有 card target：降级到非流式发送
        // 或者非流式模式：使用普通消息发送
        if (info?.kind === "final") {
          log.info(`[IntClaw][deliver] 降级到非流式发送，文本长度=${text.length}`);
          try {
            for (const chunk of core.channel.text.chunkTextWithMode(
              text,
              textChunkLimit,
              chunkMode
            )) {
              await sendMessage(
                account.config as IntclawConfig,
                sessionWebhook,
                chunk,
                {
                  useMarkdown: true,
                  log: params.runtime.log,
                  accountId: account.accountId,
                  conversationId: conversationId,
                }
              );
            }
            log.info(`[IntClaw][deliver] ✅ 非流式发送成功`);
            deliveredFinalTexts.add(text);
          } catch (error: any) {
            log.error(`[IntClaw][deliver] ❌ 非流式发送失败：${error.message}`);
            params.runtime.error?.(
              `intclaw[${account.accountId}]: non-streaming delivery failed: ${String(error)}`
            );
            // ✅ 发送兜底错误消息
            await sendFallbackErrorMessage('sendMessage', error.message);
          }
          return;
        }
      },
      onError: async (error, info) => {
        log.error(`[IntClaw][onError] ${info.kind} reply failed: ${String(error)}`);
        params.runtime.error?.(
          `intclaw[${account.accountId}] ${info.kind} reply failed: ${String(error)}`
        );
        await closeStreaming();
        typingCallbacks.onIdle?.();
      },
      onIdle: async () => {
        log.info(`[IntClaw][onIdle] 回复空闲，关闭流式`);
        await closeStreaming();
        typingCallbacks.onIdle?.();
      },
      onCleanup: () => {
        log.info(`[IntClaw][onCleanup] 清理回调`);
        typingCallbacks.onCleanup?.();
      },
    });

  // 构建完整的 replyOptions：replyOptions 只包含 onReplyStart、onTypingController、onTypingCleanup
  // deliver、onError、onIdle、onCleanup 等回调已经在 createReplyDispatcherWithTyping 的参数中定义
  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,  // ✅ 包含 onReplyStart、onTypingController、onTypingCleanup
      onModelSelected,
      ...(streamingEnabled && {
        onPartialReply: async (payload: ReplyPayload) => {
          if (!payload.text) {
            log.debug(`[WS-Streaming] 空文本，跳过`);
            return;
          }

          log.info(`[WS-Streaming] 发送 response.output_text.delta 事件，文本长度=${payload.text.length}`);
          try {
            const target = { conversationId: conversationId };
            await sendViaWSAdapter(accountId, target, {
              msgtype: 'text',
              text: { content: payload.text }
            }, { log: params.runtime.log });
          } catch (wsErr: any) {
            log.error(`[WS-Streaming] ❌ 发送 response.output_text.delta 失败：${wsErr.message}`);
          }
        },
      }),
      disableBlockStreaming: true,  // ✅ 强制使用 onPartialReply 而不是 block
    },
    markDispatchIdle,
    getAsyncModeResponse: () => asyncModeFullResponse,
  };
}