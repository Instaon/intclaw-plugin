/**
 * IntClaw WebSocket 连接层
 *
 * 职责：
 * - 管理单个IntClaw账号的 WebSocket 连接
 * - 实现应用层心跳检测（10 秒间隔，90 秒超时）
 * - 处理连接重连逻辑，带指数退避
 * - 消息去重（内置 Map，5 分钟 TTL）
 *
 * 核心特性：
 * - 关闭 SDK 内置 keepAlive，使用自定义心跳
 * - 详细的消息接收日志（三阶段：接收、解析、处理）
 * - 连接统计和监控（每分钟输出）
 */
import type { ClawdbotConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import type { ResolvedIntclawAccount } from "../types/index.ts";
import {
  isMessageProcessed,
  markMessageProcessed,
} from "../utils/utils-legacy.ts";
import { createLoggerFromConfig } from "../utils/logger.ts";
import { INTCLAW_CONFIG } from "../../config.ts";
import { setIntclawMonitorState, stopIntclawMonitorState } from "./state.ts";

// ============ 类型定义 ============

export type IntclawReactionCreatedEvent = {
  type: "reaction_created";
  channelId: string;
  messageId: string;
  userId: string;
  emoji: string;
};

export type MonitorIntclawAccountOpts = {
  cfg: ClawdbotConfig;
  account: ResolvedIntclawAccount;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  messageHandler: MessageHandler; // 直接传入消息处理器
};

// 消息处理器函数类型
export type MessageHandler = (params: {
  accountId: string;
  config: any;
  data: any;
  sessionWebhook: string;
  runtime?: RuntimeEnv;
  log?: any;
  cfg: ClawdbotConfig;
}) => Promise<void>;

// ============ 连接配置 ============

/** 心跳间隔（毫秒） */
const HEARTBEAT_INTERVAL = 10 * 1000; // 10 秒
/** 超时阈值（毫秒） */
const TIMEOUT_THRESHOLD = 20 * 1000; // 20 秒（2 次心跳未响应）
/** 基础退避时间（毫秒） */
const BASE_BACKOFF_DELAY = 1000; // 1 秒
/** 最大退避时间（毫秒） */
const MAX_BACKOFF_DELAY = 30 * 1000; // 30 秒

// ============ 监控账号 ============

export async function monitorSingleAccount(
  opts: MonitorIntclawAccountOpts,
): Promise<void> {
  const { cfg, account, runtime, abortSignal, messageHandler } = opts;
  const { accountId } = account;

  // 保存 cfg 以便传递给 messageHandler
  const clawdbotConfig = cfg;
  const log = runtime?.log;

  // 创建 debug logger（仅在 debug 模式下输出 info/debug 日志）
  const logger = createLoggerFromConfig(account.config, `IntClaw:${accountId}`);

  // 验证凭据是否存在
  if (!account.clientId || !account.clientSecret) {
    throw new Error(
      `[IntClaw][${accountId}] Missing credentials: ` +
        `clientId=${account.clientId ? "present" : "MISSING"}, ` +
        `clientSecret=${account.clientSecret ? "present" : "MISSING"}. ` +
        `Please check your configuration in channels.intclaw-connector.`,
    );
  }

  // 验证凭据格式
  const clientIdStr = String(account.clientId);
  const clientSecretStr = String(account.clientSecret);

  if (clientIdStr.length < 10 || clientSecretStr.length < 10) {
    throw new Error(
      `[IntClaw][${accountId}] Invalid credentials format: ` +
        `clientId length=${clientIdStr.length}, clientSecret length=${clientSecretStr.length}. ` +
        `Credentials appear to be too short or invalid.`,
    );
  }

  logger.info(`Starting IntClaw Stream client...`);
  logger.info(`Initializing with clientId: ${clientIdStr.substring(0, 8)}...`);
  logger.info(`WebSocket keepAlive: false (using application-layer heartbeat)`);

  // 动态导入 ws 模块
  const wsModule = await import("ws");
  const WebSocket = wsModule.default;

  // 包装器，兼容原有的 client 接口
  const client = {
    socket: null as import("ws").WebSocket | null,
    messageHandlers: new Map<string, (res: any) => void>(),
    
    // 连接
    connect: async () => {
      return new Promise<void>((resolve, reject) => {
        const endpoint = account.config.endpoint || INTCLAW_CONFIG.WS_ENDPOINT;
        const headers = {
          "x-app-key": String(account.clientId),
          "x-app-secret": String(account.clientSecret),
        };

        logger.info(`开始连接 WebSocket: ${endpoint}`);
        const ws = new WebSocket(endpoint, { headers });

        const onOpen = () => {
          ws.removeListener('error', onError);
          client.socket = ws;
          rebindListeners();
          logger.info(`[WS连接] 成功: ${endpoint}`);
          resolve();
        };

        const onError = (err: any) => {
          ws.removeListener('open', onOpen);
          logger.error(`[WS连接] 失败: ${endpoint}, 错误: ${err.message || err}`);
          reject(err);
        };
        ws.once('open', onOpen);
        ws.once('error', onError);
      });
    },
    
    // 断开
    disconnect: async () => {
      if (client.socket) {
        client.socket.removeAllListeners();
        client.socket.terminate();
        client.socket = null;
      }
    },
    
    // 回复响应
    socketCallBackResponse: (messageId: string, payload: any) => {
      if (client.socket && client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(JSON.stringify({
          headers: { messageId },
          data: payload
        }));
      }
    },
    
    // 注册消息处理
    registerCallbackListener: (topic: string, handler: (res: any) => void) => {
      client.messageHandlers.set(topic, handler);
    },
    
    // 处理旧的 client.on
    on: (evt: string, cb: any) => {}
  };

  // ============ 连接状态管理 ============

  let lastSocketAvailableTime = Date.now();
  let connectionEstablishedTime = Date.now(); // 记录连接建立时间
  let isReconnecting = false;
  let reconnectAttempts = 0;
  let keepAliveTimer: NodeJS.Timeout | null = null;
  let isStopped = false;
  
  // ============ 消息处理活跃标记 ============
  // 用于在消息处理期间防止心跳超时触发重连
  let activeMessageProcessing = false;
  let messageProcessingKeepAliveTimer: NodeJS.Timeout | null = null;
  
  /**
   * 标记消息处理开始，启动定期更新机制
   * 在消息处理期间，每 30 秒更新一次 lastSocketAvailableTime
   * 防止长时间处理（如复杂的 AI 任务）触发心跳超时
   */
  function markMessageProcessingStart() {
    activeMessageProcessing = true;
    lastSocketAvailableTime = Date.now();
    
    // 清理旧的定时器（如果存在）
    if (messageProcessingKeepAliveTimer) {
      clearInterval(messageProcessingKeepAliveTimer);
    }
    
    // 每 30 秒更新一次，确保不会触发 90 秒超时
    messageProcessingKeepAliveTimer = setInterval(() => {
      if (activeMessageProcessing) {
        lastSocketAvailableTime = Date.now();
        logger.debug(`📝 消息处理中，更新 socket 可用时间`);
      }
    }, 30 * 1000); // 30 秒间隔
    
    logger.debug(`📝 消息处理开始，启动活跃标记定时器`);
  }
  
  /**
   * 标记消息处理结束，停止定期更新机制
   */
  function markMessageProcessingEnd() {
    activeMessageProcessing = false;
    
    if (messageProcessingKeepAliveTimer) {
      clearInterval(messageProcessingKeepAliveTimer);
      messageProcessingKeepAliveTimer = null;
    }
    
    // 最后更新一次时间
    lastSocketAvailableTime = Date.now();
    logger.debug(`✅ 消息处理结束，清理活跃标记定时器`);
  }

  // ============ 辅助函数 ============

  /** 计算指数退避延迟（带抖动） */
  function calculateBackoffDelay(attempt: number): number {
    const exponentialDelay = BASE_BACKOFF_DELAY * Math.pow(2, attempt);
    const jitter = Math.random() * 1000; // 0-1 秒随机抖动
    return Math.min(exponentialDelay + jitter, MAX_BACKOFF_DELAY);
  }

  /** 统一重连函数，带指数退避（无限重连） */
  async function doReconnect(immediate = false) {
    if (isReconnecting || isStopped) {
      logger.debug(`正在重连中或已停止，跳过`);
      return;
    }

    isReconnecting = true;

    // 应用指数退避（非立即重连时）
    if (!immediate && reconnectAttempts > 0) {
      const delay = calculateBackoffDelay(reconnectAttempts);
      logger.info(
        `⏳ 等待 ${Math.round(delay / 1000)} 秒后重连 (尝试 ${reconnectAttempts + 1})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      // 1. 先断开旧连接（检查 WebSocket 状态）
      if (client.socket?.readyState === 1 || client.socket?.readyState === 3) {
        await client.disconnect();
        logger.info(`已断开旧连接`);
      }

      // 2. 重新建立连接
      await client.connect();

      // 3. 等待连接真正建立（监听 open 事件，最多等待 10 秒）
      const connectionEstablished = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          resolve(false);
        }, 10_000); // 10 秒超时

        // 如果已经是 OPEN 状态，直接返回
        if (client.socket?.readyState === 1) {
          clearTimeout(timeout);
          resolve(true);
          return;
        }

        // 否则监听 open 事件
        const onOpen = () => {
          clearTimeout(timeout);
          client.socket?.removeListener('open', onOpen);
          client.socket?.removeListener('error', onError);
          resolve(true);
        };

        const onError = (err: any) => {
          clearTimeout(timeout);
          client.socket?.removeListener('open', onOpen);
          client.socket?.removeListener('error', onError);
          logger.warn(`连接建立失败: ${err.message}`);
          resolve(false);
        };

        client.socket?.once('open', onOpen);
        client.socket?.once('error', onError);
      });

      if (!connectionEstablished) {
        throw new Error(`连接建立超时或失败`);
      }

      // 4. 重置 socket 可用时间、连接建立时间和重连计数
      lastSocketAvailableTime = Date.now();
      connectionEstablishedTime = Date.now(); // 重置连接建立时间
      reconnectAttempts = 0; // 重连成功，重置计数

      logger.info(`✅ 重连成功 (socket 状态=${client.socket?.readyState})`);
    } catch (err: any) {
      reconnectAttempts++;
      log?.error?.(
        `重连失败：${err.message} (尝试 ${reconnectAttempts})`,
      );
      throw err;
    } finally {
      isReconnecting = false;
    }
  }

  /** 重新绑定所有 WebSocket 事件监听器 */
  function rebindListeners() {
    if (!client.socket) return;
    
    client.socket.on("pong", () => {
      lastSocketAvailableTime = Date.now();
    });

    client.socket.on("message", (data: any) => {
      try {
        const payload = Object.prototype.toString.call(data) === '[object Buffer]' ? data.toString() : data as string;
        logger.info(`[WS收到] 包: ${payload}`);
        const msg = JSON.parse(payload);
        
        // 检查 disconnect 类型
        if (msg.type === "SYSTEM" && msg.headers?.topic === "disconnect") {
          if (!isStopped && !isReconnecting) {
            doReconnect(true).catch((err) => {
              log?.error?.(`[${accountId}] 重连失败：${err.message}`);
            });
          }
          return;
        }
        
        // 获取 topic: 优先取 headers.topic，然后取 type (例如 MESSAGE/EVENT) 作为 fallback，再默认转为 'robot'
        const rawTopic = msg.headers?.topic || msg.type || "robot";
        // 如果是标准的机器人消息话题
        const topic = (rawTopic === "/v1.0/im/bot/messages" || rawTopic === "MESSAGE" || msg.msgtype) ? "robot" : rawTopic;

        // 派发给外部 handler
        const handler = client.messageHandlers.get(topic);
        if (handler) {
          const res = msg.headers ? msg : { headers: { messageId: msg.msgId || msg.messageId }, data: payload };
          handler(res);
        } else {
          logger.debug(`未找到对应 topic 的处理函数：${topic}`);
        }
      } catch (e) {
        // 忽略解析错误
      }
    });

    client.socket.on("close", (code, reason) => {
      logger.info(
        `WebSocket close: code=${code}, reason=${reason || "未知"}, isStopped=${isStopped}`
      );

      if (isStopped) {
        return;
      }

      setTimeout(() => {
        doReconnect(true).catch((err) => {
          log?.error?.(`重连失败：${err.message}`);
        });
      }, 0);
    });
    
    client.socket.on("error", (err) => {
      log?.error?.(`WebSocket Error: ${err.message}`);
    });
  }

  /**
   * 启动 keepAlive 机制（单定时器 + 指数退避）
   *
   * 业界最佳实践：
   * - 单定时器：每 10 秒检查一次，同时完成心跳和超时检测
   * - 使用 WebSocket 原生 Ping
   * - 指数退避重连：避免雪崩效应
   */
  function startKeepAlive(): () => void {
    logger.debug(
      `🚀 启动 keepAlive 定时器，间隔=${HEARTBEAT_INTERVAL / 1000}秒`,
    );

    keepAliveTimer = setInterval(async () => {
      if (isStopped) {
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        return;
      }

      try {
        const elapsed = Date.now() - lastSocketAvailableTime;

        // 【超时检测】超过 90 秒未确认 socket 可用，触发重连
        if (elapsed > TIMEOUT_THRESHOLD) {
          logger.info(
            `⚠️ 超时检测：已 ${Math.round(elapsed / 1000)} 秒未确认 socket 可用，触发重连...`,
          );
          await doReconnect();
          return;
        }

        // 【心跳检测】检查 socket 状态
        const socketState = client.socket?.readyState;
        const timeSinceConnection = Date.now() - connectionEstablishedTime;
        logger.debug(
          `🔍 心跳检测：socket 状态=${socketState}, elapsed=${Math.round(elapsed / 1000)}s, 连接已建立=${Math.round(timeSinceConnection / 1000)}s`,
        );

        // 给新建立的连接 15 秒宽限期，避免在连接建立初期就触发重连
        if (socketState !== 1) {
          if (timeSinceConnection < 15_000) {
            logger.debug(
              `⏳ 连接建立中（已 ${Math.round(timeSinceConnection / 1000)}s），跳过状态检查`,
            );
            return;
          }
          
          logger.info(
            `⚠️ 心跳检测：socket 状态=${socketState}，触发重连...`,
          );
          await doReconnect(true); // 立即重连，不退避
          return;
        }

        // 【发送原生 Ping】更新可用时间
        try {
          client.socket?.ping();
          lastSocketAvailableTime = Date.now();
        } catch (err: any) {
          log?.warn?.(`发送 PING 失败：${err.message}`);
          // 发送失败也计入超时
        }
      } catch (err: any) {
        log?.error?.(`keepAlive 检测失败：${err.message}`);
      }
    }, HEARTBEAT_INTERVAL); // 每 10 秒检测一次

    logger.debug(`✅ keepAlive 定时器已启动`);

    // 返回清理函数
    return () => {
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      keepAliveTimer = null;
      logger.debug(`keepAlive 定时器已清理`);
    };
  }

  /** 停止并清理所有资源 */
  function stop() {
    isStopped = true;

    // 清理心跳定时器
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = null;

    // 清理消息处理活跃标记定时器
    if (messageProcessingKeepAliveTimer) {
      clearInterval(messageProcessingKeepAliveTimer);
      messageProcessingKeepAliveTimer = null;
    }

    // 清理事件监听器
    if (client.socket) {
      client.socket.removeAllListeners();
    }

    logger.debug(`Connection 已停止`);
  }

  // 事件监听将在 connect() 中的 onOpen 中绑定

  return new Promise<void>(async (resolve, reject) => {
    // Handle abort signal
    if (abortSignal) {
      const onAbort = async () => {
        logger.info(`Abort signal received, stopping...`);
        stop();
        try {
          // 只在连接已建立时才断开
          if (client.socket && client.socket.readyState === 1) {
            await client.disconnect();
          }
        } catch (err: any) {
          log?.warn?.(`断开连接时出错：${err.message}`);
        }
        resolve();
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    // 消息接收统计（用于检测消息丢失）
    let receivedCount = 0;
    let processedCount = 0;
    let lastMessageTime = Date.now();

    // 定期输出统计信息
    const statsInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastMessage = Math.round((now - lastMessageTime) / 1000);
      logger.info(
        `统计：收到=${receivedCount}, 处理=${processedCount}, ` +
          `丢失=${receivedCount - processedCount}, 距上次消息=${timeSinceLastMessage}s`,
      );
    }, 60000); // 每分钟输出一次

    // Register message handler
    client.registerCallbackListener("robot", async (res: any) => {
      receivedCount++;
      lastMessageTime = Date.now();
      const messageId = res.headers?.messageId;
      const timestamp = new Date().toISOString();

      // ===== 第一步：记录原始消息接收 =====
      logger.info(`\n========== 收到新消息 ==========`);
      logger.info(`时间：${timestamp}`);
      logger.info(`MessageId: ${messageId || "N/A"}`);
      logger.info(`Headers: ${JSON.stringify(res.headers || {})}`);
      logger.info(`Data 长度：${res.data?.length || 0} 字符`);

      // 立即确认回调
      if (messageId) {
        client.socketCallBackResponse(messageId, { success: true });
        logger.info(`✅ 已立即确认回调：messageId=${messageId}`);
      } else {
        log?.warn?.(`⚠️ 警告：消息没有 messageId`);
      }

      // 消息去重
      if (messageId && isMessageProcessed(messageId)) {
        log?.warn?.(`⚠️ 检测到重复消息，跳过处理：messageId=${messageId}`);
        logger.info(`========== 消息处理结束（重复） ==========\n`);
        return;
      }

      if (messageId) {
        markMessageProcessed(messageId);
        logger.info(`标记消息为已处理：messageId=${messageId}`);
      }

      // 异步处理消息
      // ✅ 标记消息处理开始，防止长时间处理触发心跳超时
      markMessageProcessingStart();
      
      try {
        // 解析消息数据
        let data;
        try {
          data = JSON.parse(res.data);
        } catch (parseError: any) {
          logger.error('Failed to parse response data as JSON:', {
            error: parseError instanceof Error ? parseError.message : String(parseError),
            rawData: typeof res.data === 'string' 
              ? res.data.substring(0, 500) // 只记录前 500 字符
              : res.data,
            dataType: typeof res.data,
          });
          throw new Error(
            `Invalid JSON response from IntClaw API. ` +
            `Error: ${parseError instanceof Error ? parseError.message : String(parseError)}. ` +
            `Raw data (first 100 chars): ${String(res.data).substring(0, 100)}`
          );
        }

        // ===== 第二步：记录解析后的消息详情 =====
        logger.info(`\n----- 消息详情 -----`);
        logger.info(`消息类型：${data.msgtype || "unknown"}`);
        logger.info(
          `会话类型：${data.conversationType === "1" ? "DM (单聊)" : data.conversationType === "2" ? "Group (群聊)" : data.conversationType}`,
        );
        logger.info(
          `发送者：${data.senderNick || "unknown"} (${data.senderStaffId || data.senderId || "unknown"})`,
        );
        logger.info(`会话 ID: ${data.conversationId || "N/A"}`);
        logger.info(`消息 ID: ${data.msgId || "N/A"}`);
        logger.info(
          `SessionWebhook: ${data.sessionWebhook ? "已提供" : "未提供"}`,
        );
        logger.info(
          `RobotCode: ${data.robotCode || account.config?.clientId || "N/A"}`,
        );

        // 记录消息内容（简化版，避免过长）
        let contentPreview = "N/A";
        if (data.text?.content) {
          contentPreview =
            data.text.content.length > 100
              ? data.text.content.substring(0, 100) + "..."
              : data.text.content;
        } else if (data.content) {
          contentPreview =
            JSON.stringify(data.content).substring(0, 100) + "...";
        }
        logger.info(`消息内容预览：${contentPreview}`);
        logger.info(`完整数据字段：${Object.keys(data).join(", ")}`);
        logger.info(`----- 消息详情结束 -----\n`);

        // ===== 第三步：开始处理消息 =====
        logger.info(`🚀 开始处理消息...`);

        await messageHandler({
          accountId,
          config: account.config,
          data,
          sessionWebhook: data.sessionWebhook,
          runtime,
          log,
          cfg: clawdbotConfig,
        });

        processedCount++;
        logger.info(`✅ 消息处理完成 (${processedCount}/${receivedCount})`);
        logger.info(`========== 消息处理结束（成功） ==========\n`);
      } catch (error: any) {
        processedCount++;
        const errorMsg = `❌ 处理消息异常 (${processedCount}/${receivedCount}): ${error?.message || "未知错误"}`;
        const errorStack = error?.stack || "无堆栈信息";
        
        // 使用 logger 确保错误信息一定会被打印
        logger.info(errorMsg);
        logger.info(`错误堆栈:\n${errorStack}`);
        
        // 同时使用 log?.error 记录（如果可用）
        log?.error?.(errorMsg);
        log?.error?.(`错误堆栈:\n${errorStack}`);
        
        logger.info(`========== 消息处理结束（失败） ==========\n`);
      } finally {
        // ✅ 无论成功或失败，都要标记消息处理结束
        markMessageProcessingEnd();
      }
    });

    // 清理定时器
    const cleanup = () => {
      stopIntclawMonitorState(accountId);
      clearInterval(statsInterval);
      stop();
    };

    // Connect to IntClaw Stream
    try {
      await client.connect();
      logger.info(`Connected to IntClaw Stream successfully`);
      logger.info(`PID: ${process.pid}`);
      // Register the connected client globally
      setIntclawMonitorState(accountId, { running: true, client: client as any });
      logger.info(
        `✅ 自定义 keepAlive: true (10 秒心跳，90 秒超时), 指数退避重连`,
      );

      // 启动自定义心跳检测
      const cleanupKeepAlive = startKeepAlive();

      // 重写 cleanup 函数，包含 keepAlive 清理
      const enhancedCleanup = () => {
        cleanupKeepAlive();
        clearInterval(statsInterval);
        stop();
      };

      // 进程退出时清理（使用 once 确保只执行一次）
      process.once("exit", enhancedCleanup);
      process.once("SIGINT", enhancedCleanup);
      process.once("SIGTERM", enhancedCleanup);
    } catch (error: any) {
      cleanup(); // 连接失败时清理资源

      // 记录完整错误信息用于调试
      logger.info(`连接失败，错误详情：`);
      logger.info(`  - error.message: ${error.message}`);
      logger.info(`  - error.response?.status: ${error.response?.status}`);
      logger.info(`  - error.response?.data: ${JSON.stringify(error.response?.data || {})}`);
      logger.info(`  - error.code: ${error.code}`);
      logger.info(`  - error.stack: ${error.stack?.split('\n').slice(0, 3).join('\n')}`);

      // 处理 400 错误（请求参数错误）
      if (error.response?.status === 400 || error.message?.includes("status code 400") || error.message?.includes("400")) {
        throw new Error(
          `[IntClaw][${accountId}] Bad Request (400):\n` +
            `  - clientId or clientSecret format is invalid\n` +
            `  - clientId: ${clientIdStr} (type: ${typeof account.clientId}, length: ${clientIdStr.length})\n` +
            `  - clientSecret: ****** (type: ${typeof account.clientSecret}, length: ${clientSecretStr.length})\n` +
            `  - Common issues:\n` +
            `    1. clientId/clientSecret must be strings, not numbers\n` +
            `    2. Remove any quotes or special characters\n` +
            `    3. Ensure credentials are from the correct IntClaw app\n` +
            `    4. Check if clientId starts with 'ding' prefix\n` +
            `  - Error details: ${error.message}\n` +
            `  - Response data: ${JSON.stringify(error.response?.data || {})}`,
        );
      }

      // 处理 401 认证错误
      if (error.response?.status === 401 || error.message?.includes("401")) {
        throw new Error(
          `[IntClaw][${accountId}] Authentication failed (401 Unauthorized):\n` +
            `  - Your clientId or clientSecret is invalid, expired, or revoked\n` +
            `  - clientId: ${clientIdStr.substring(0, 8)}...\n` +
            `  - Please verify your credentials at IntClaw Developer Console\n` +
            `  - Error details: ${error.message}`,
        );
      }

      // 处理其他连接错误
      throw new Error(
        `[IntClaw][${accountId}] Failed to connect to IntClaw Stream: ${error.message}`,
      );
    }

    // Handle disconnection（已被自定义 close 监听器替代）
    // client.on('close', ...) - 已移除，使用 setupCloseListener

    client.on("error", (err: Error) => {
      log?.error?.(`Connection error: ${err.message}`);
    });

    // 监听重连事件（仅用于日志，实际重连由自定义逻辑处理）
    client.on("reconnect", () => {
      logger.info(`SDK reconnecting...`);
    });

    client.on("reconnected", () => {
      logger.info(`✅ SDK reconnected successfully`);
    });
  });
}

export function resolveReactionSyntheticEvent(
  event: any,
): IntclawReactionCreatedEvent | null {
  void event;
  return null;
}
