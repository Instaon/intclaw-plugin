/**
 * Configuration Management Module
 * 
 * This module centralizes all runtime constants for the InstaClaw Connector plugin,
 * including WebSocket connection parameters, heartbeat settings, reconnection strategy,
 * and other operational constants.
 * 
 * Validates: Requirements 7.1, 12.2, 13.1, 14.2
 */

/**
 * WebSocket 服务器地址
 * 默认连接到 InstaClaw 开发环境
 * 可通过环境变量 INSTACLAW_WS_URL 覆盖
 * 
 * Validates: Requirements 7.1, 12.2
 */
export const WS_URL = process.env.INSTACLAW_WS_URL || "wss://claw-dev.int-os.com/user-ws/";

/**
 * 心跳间隔（毫秒）
 * 默认 30 秒，可通过环境变量 INSTACLAW_HEARTBEAT_INTERVAL 配置
 * 
 * Validates: Requirements 12.2, 13.1
 */
export const HEARTBEAT_INTERVAL = parseInt(
  process.env.INSTACLAW_HEARTBEAT_INTERVAL || "30000",
  10
);

/**
 * 超时阈值（毫秒）
 * 默认 60 秒（2 次心跳未响应）
 * 超过此时间未收到 pong 响应将触发重连
 * 
 * Validates: Requirements 12.2, 13.1
 */
export const TIMEOUT_THRESHOLD = parseInt(
  process.env.INSTACLAW_TIMEOUT_THRESHOLD || "60000",
  10
);

/**
 * 基础退避时间（毫秒）
 * 重连延迟的起始值，用于指数退避计算
 * 
 * Validates: Requirements 12.2, 14.2
 */
export const BASE_BACKOFF_DELAY = 1000;

/**
 * 最大退避时间（毫秒）
 * 重连延迟的上限，防止延迟过长
 * 
 * Validates: Requirements 12.2, 14.2
 */
export const MAX_BACKOFF_DELAY = 30000;

/**
 * 最大重连次数
 * 0 表示无限重连，不放弃连接尝试
 * 
 * Validates: Requirements 12.2, 14.2
 */
export const MAX_RECONNECT_ATTEMPTS = 0;

/**
 * Response 状态清理阈值（毫秒）
 * 超过此时间未完成的 Response 将被清理，防止内存泄漏
 * 默认 5 分钟
 * 
 * Validates: Requirements 12.2
 */
export const STALE_RESPONSE_THRESHOLD = 5 * 60 * 1000; // 5 分钟

/**
 * 文本分块大小（字符数）
 * 用于模拟流式输出，将长文本分成多个 delta 事件发送
 * 
 * Validates: Requirements 12.2
 */
export const TEXT_CHUNK_SIZE = 50;
