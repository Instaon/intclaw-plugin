/**
 * IntClaw插件工具函数
 */

import type { IntclawConfig, ResolvedIntclawAccount } from '../types/index.ts';
import { INTCLAW_CONFIG } from '../../config.ts';

// ============ 常量 ============

/** 默认账号 ID，用于标记单账号模式（无 accounts 配置）时的内部标识 */
export const DEFAULT_ACCOUNT_ID = '__default__';

/** 新会话触发命令 */
export const NEW_SESSION_COMMANDS = ['/new', '/reset', '/clear', '新会话', '重新开始', '清空对话'];

/** IntClaw API 常量 */
export const INTCLAW_API = INTCLAW_CONFIG.API_BASE_URL;
export const INTCLAW_OAPI = INTCLAW_CONFIG.OAPI_BASE_URL;

// ============ 会话管理 ============

/** OpenClaw 标准会话上下文 */
export interface SessionContext {
  channel: 'intclaw-connector';
  accountId: string;
  chatType: 'direct' | 'group';
  peerId: string;
  conversationId?: string;
  senderName?: string;
  groupSubject?: string;
}

/**
 * 构建 OpenClaw 标准会话上下文
 * 遵循 OpenClaw session.dmScope 机制，让 Gateway 根据配置自动处理会话隔离
 */
export function buildSessionContext(params: {
  accountId: string;
  senderId: string;
  senderName?: string;
  conversationType: string;
  conversationId?: string;
  groupSubject?: string;
  separateSessionByConversation?: boolean;
  groupSessionScope?: 'group' | 'group_sender';
  sharedMemoryAcrossConversations?: boolean;
}): SessionContext {
  const {
    accountId,
    senderId,
    senderName,
    conversationType,
    conversationId,
    groupSubject,
    separateSessionByConversation,
    groupSessionScope,
    sharedMemoryAcrossConversations,
  } = params;
  const isDirect = conversationType === '1';

  // sharedMemoryAcrossConversations=true 时，所有会话共享记忆
  if (sharedMemoryAcrossConversations === true) {
    return {
      channel: 'intclaw-connector',
      accountId,
      chatType: isDirect ? 'direct' : 'group',
      peerId: accountId, // 使用 accountId 作为 peerId，实现跨会话记忆共享
      conversationId: isDirect ? undefined : conversationId,
      senderName,
      groupSubject: isDirect ? undefined : groupSubject,
    };
  }

  // separateSessionByConversation=false 时，不区分单聊/群聊，按用户维度维护 session
  if (separateSessionByConversation === false) {
    return {
      channel: 'intclaw-connector',
      accountId,
      chatType: isDirect ? 'direct' : 'group',
      peerId: senderId, // 只用 senderId，不区分会话
      senderName,
    };
  }

  // 以下是 separateSessionByConversation=true（默认）的逻辑
  if (isDirect) {
    // 单聊：peerId 为发送者 ID，由 OpenClaw Gateway 根据 dmScope 配置处理
    return {
      channel: 'intclaw-connector',
      accountId,
      chatType: 'direct',
      peerId: senderId,
      senderName,
    };
  }

  // 群聊：根据 groupSessionScope 配置决定会话隔离策略
  if (groupSessionScope === 'group_sender') {
    // 群内每个用户独立会话
    return {
      channel: 'intclaw-connector',
      accountId,
      chatType: 'group',
      peerId: `${conversationId}:${senderId}`,
      conversationId,
      senderName,
      groupSubject,
    };
  }

  // 默认：整个群共享一个会话
  return {
    channel: 'intclaw-connector',
    accountId,
    chatType: 'group',
    peerId: conversationId || senderId,
    conversationId,
    senderName,
    groupSubject,
  };
}

/**
 * 检查消息是否是新会话命令
 */
export function normalizeSlashCommand(text: string): string {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (NEW_SESSION_COMMANDS.some((cmd) => lower === cmd.toLowerCase())) {
    return '/new';
  }
  return text;
}

// ============ Access Token 缓存 ============

type CachedToken = {
  token: string;
  expiryMs: number;
};

// 注意：这里仍被部分新逻辑引用（如 message-handler），必须支持多账号，不能用全局单例缓存
const apiTokenCache = new Map<string, CachedToken>();
const oapiTokenCache = new Map<string, CachedToken>();

function cacheKey(config: IntclawConfig): string {
  const clientId = String((config as any)?.clientId ?? '').trim();
  
  // 添加校验
  if (!clientId) {
    throw new Error(
      'Invalid IntclawConfig: clientId is required for token caching. ' +
      'Please ensure your configuration includes a valid clientId.'
    );
  }
  
  return clientId;
}

/**
 * 获取IntClaw Access Token（新版 API）
 */
export async function getAccessToken(config: IntclawConfig): Promise<string> {
  const now = Date.now();
  const key = cacheKey(config);
  const cached = apiTokenCache.get(key);
  if (cached && cached.expiryMs > now + 60_000) {
    return cached.token;
  }

  const { intclawHttp } = await import('./http-client.ts');
  const response = await intclawHttp.post(`${INTCLAW_API}/v1.0/oauth2/accessToken`, {
    appKey: config.clientId,
    appSecret: config.clientSecret,
  });

  const token = response.data.accessToken as string;
  const expireInSec = Number(response.data.expireIn ?? 0);
  apiTokenCache.set(key, { token, expiryMs: now + expireInSec * 1000 });
  return token;
}

/**
 * 获取IntClaw OAPI Access Token（旧版 API，用于媒体上传等）
 */
export async function getOapiAccessToken(config: IntclawConfig): Promise<string | null> {
  try {
    const now = Date.now();
    const key = cacheKey(config);
    const cached = oapiTokenCache.get(key);
    if (cached && cached.expiryMs > now + 60_000) {
      return cached.token;
    }

    const { intclawOapiHttp } = await import('./http-client.ts');
    const resp = await intclawOapiHttp.get(`${INTCLAW_OAPI}/gettoken`, {
      params: { appkey: config.clientId, appsecret: config.clientSecret },
    });
    if (resp.data?.errcode === 0 && resp.data?.access_token) {
      const token = String(resp.data.access_token);
      const expiresInSec = Number(resp.data.expires_in ?? 7200);
      oapiTokenCache.set(key, { token, expiryMs: now + expiresInSec * 1000 });
      return token;
    }
    return null;
  } catch {
    return null;
  }
}

// ============ 用户 ID 转换 ============

/** staffId → unionId 缓存（带过期时间的 LRU 缓存） */
const MAX_UNION_ID_CACHE_SIZE = 1000;
const UNION_ID_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 小时

interface UnionIdCacheEntry {
  unionId: string;
  timestamp: number;
}

const unionIdCache = new Map<string, UnionIdCacheEntry>();

/**
 * 通过 oapi 旧版接口将 staffId 转换为 unionId
 */
export async function getUnionId(
  staffId: string,
  config: IntclawConfig,
  log?: any,
): Promise<string | null> {
  // 检查缓存
  const cached = unionIdCache.get(staffId);
  if (cached && Date.now() - cached.timestamp < UNION_ID_CACHE_TTL) {
    return cached.unionId;
  }

  try {
    const token = await getOapiAccessToken(config);
    if (!token) {
      log?.error?.('[IntClaw] getUnionId: 无法获取 oapi access_token');
      return null;
    }
    const { intclawOapiHttp } = await import('./http-client.ts');
    const resp = await intclawOapiHttp.get(`${INTCLAW_OAPI}/user/get`, {
      params: { access_token: token, userid: staffId },
      timeout: 10_000,
    });
    const unionId = resp.data?.unionid;
    if (unionId) {
      // 写入缓存前检查大小
      if (unionIdCache.size >= MAX_UNION_ID_CACHE_SIZE) {
        // 删除最旧的条目
        let oldestKey: string | null = null;
        let oldestTime = Date.now();
        
        for (const [key, entry] of unionIdCache.entries()) {
          if (entry.timestamp < oldestTime) {
            oldestTime = entry.timestamp;
            oldestKey = key;
          }
        }
        
        if (oldestKey) {
          unionIdCache.delete(oldestKey);
        }
      }
      
      unionIdCache.set(staffId, { unionId, timestamp: Date.now() });
      log?.info?.(`[IntClaw] getUnionId: ${staffId} → ${unionId}`);
      return unionId;
    }
    log?.error?.(`[IntClaw] getUnionId: 响应中无 unionid 字段: ${JSON.stringify(resp.data)}`);
    return null;
  } catch (err: any) {
    log?.error?.(`[IntClaw] getUnionId 失败: ${err.message}`);
    return null;
  }
}

// ============ 消息去重 ============

/** 消息去重缓存 Map<messageId, timestamp> - 防止同一消息被重复处理 */
const processedMessages = new Map<string, number>();

/** 消息去重缓存过期时间（5分钟） */
const MESSAGE_DEDUP_TTL = 5 * 60 * 1000;

/** 定时清理器 */
let cleanupTimer: NodeJS.Timeout | null = null;

/**
 * 清理过期的消息去重缓存
 */
export function cleanupProcessedMessages(): void {
  const now = Date.now();
  for (const [msgId, timestamp] of processedMessages.entries()) {
    if (now - timestamp > MESSAGE_DEDUP_TTL) {
      processedMessages.delete(msgId);
    }
  }
}

/**
 * 启动定时清理机制
 */
export function startMessageCleanup(): void {
  if (cleanupTimer) return; // 防止重复启动
  
  // 每 5 分钟清理一次
  cleanupTimer = setInterval(() => {
    cleanupProcessedMessages();
  }, 5 * 60 * 1000);
}

/**
 * 停止定时清理机制
 */
export function stopMessageCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * 检查消息是否已处理过（去重）
 */
export function isMessageProcessed(messageId: string): boolean {
  if (!messageId) return false;
  return processedMessages.has(messageId);
}

/**
 * 标记消息为已处理
 */
export function markMessageProcessed(messageId: string): void {
  if (!messageId) return;
  processedMessages.set(messageId, Date.now());
  // 定期清理（每处理100条消息清理一次）
  if (processedMessages.size >= 100) {
    cleanupProcessedMessages();
  }
}

// ============ 配置工具 ============

/**
 * 获取IntClaw配置
 */
export function getIntclawConfig(cfg: any): IntclawConfig {
  return (cfg?.channels as any)?.['intclaw-connector'] || {};
}

/**
 * 检查是否已配置
 */
export function isIntclawConfigured(cfg: any): boolean {
  const config = getIntclawConfig(cfg);
  return Boolean(config.clientId && config.clientSecret);
}

/**
 * 构建媒体系统提示词
 */
export function buildMediaSystemPrompt(): string {
  return `## IntClaw图片和文件显示规则

你正在IntClaw中与用户对话。

### 一、图片显示

显示图片时，直接使用本地文件路径，系统会自动上传处理。

**正确方式**：
\`\`\`markdown
![描述](file:///path/to/image.jpg)
![描述](/tmp/screenshot.png)
![描述](/Users/xxx/photo.jpg)
\`\`\`

**禁止**：
- 不要自己执行 curl 上传
- 不要猜测或构造 URL
- **不要对路径进行转义（如使用反斜杠 \\ ）**

直接输出本地路径即可，系统会自动上传到IntClaw。

### 二、视频分享

**何时分享视频**：
- ✅ 用户明确要求**分享、发送、上传**视频时
- ❌ 仅生成视频保存到本地时，**不需要**分享

**视频标记格式**：
当需要分享视频时，在回复**末尾**添加：

\`\`\`
[INTCLAW_VIDEO]{"path":"<本地视频路径>"}[/INTCLAW_VIDEO]
\`\`\`

**支持格式**：mp4（最大 20MB）

**重要**：
- 视频大小不得超过 20MB，超过限制时告知用户
- 仅支持 mp4 格式
- 系统会自动提取视频时长、分辨率并生成封面

### 三、音频分享

**何时分享音频**：
- ✅ 用户明确要求**分享、发送、上传**音频/语音文件时
- ❌ 仅生成音频保存到本地时，**不需要**分享

**音频标记格式**：
当需要分享音频时，在回复**末尾**添加：

\`\`\`
[INTCLAW_AUDIO]{"path":"<本地音频路径>"}[/INTCLAW_AUDIO]
\`\`\`

**支持格式**：ogg、amr（最大 20MB）

**重要**：
- 音频大小不得超过 20MB，超过限制时告知用户
- 系统会自动提取音频时长

### 四、文件分享

**何时分享文件**：
- ✅ 用户明确要求**分享、发送、上传**文件时
- ❌ 仅生成文件保存到本地时，**不需要**分享

**文件标记格式**：
当需要分享文件时，在回复**末尾**添加：

\`\`\`
[INTCLAW_FILE]{"path":"<本地文件路径>","fileName":"<文件名>","fileType":"<扩展名>"}[/INTCLAW_FILE]
\`\`\`

**支持的文件类型**：几乎所有常见格式

**重要**：文件大小不得超过 20MB，超过限制时告知用户文件过大。`;
}

// ============ 消息表情回复 ============

/**
 * 在用户消息上贴 🤔思考中 表情，表示正在处理
 */
export async function addEmotionReply(config: IntclawConfig, data: any, log?: any): Promise<void> {
  if (!data.msgId || !data.conversationId) return;
  try {
    const token = await getAccessToken(config);
    const { intclawHttp } = await import('./http-client.ts');
    await intclawHttp.post(`${INTCLAW_API}/v1.0/robot/emotion/reply`, {
      robotCode: data.robotCode ?? config.clientId,
      openMsgId: data.msgId,
      openConversationId: data.conversationId,
      emotionType: 2,
      emotionName: '🤔思考中',
      textEmotion: {
        emotionId: '2659900',
        emotionName: '🤔思考中',
        text: '🤔思考中',
        backgroundId: 'im_bg_1',
      },
    }, {
      headers: { 'x-acs-intclaw-access-token': token, 'Content-Type': 'application/json' },
      timeout: 5_000,
    });
    log?.info?.(`[IntClaw][Emotion] 贴表情成功: msgId=${data.msgId}`);
  } catch (err: any) {
    log?.warn?.(`[IntClaw][Emotion] 贴表情失败（不影响主流程）: ${err.message}`);
  }
}

/**
 * 撤回用户消息上的 🤔思考中 表情
 */
export async function recallEmotionReply(config: IntclawConfig, data: any, log?: any): Promise<void> {
  if (!data.msgId || !data.conversationId) return;
  try {
    const token = await getAccessToken(config);
    const { intclawHttp } = await import('./http-client.ts');
    await intclawHttp.post(`${INTCLAW_API}/v1.0/robot/emotion/recall`, {
      robotCode: data.robotCode ?? config.clientId,
      openMsgId: data.msgId,
      openConversationId: data.conversationId,
      emotionType: 2,
      emotionName: '🤔思考中',
      textEmotion: {
        emotionId: '2659900',
        emotionName: '🤔思考中',
        text: '🤔思考中',
        backgroundId: 'im_bg_1',
      },
    }, {
      headers: { 'x-acs-intclaw-access-token': token, 'Content-Type': 'application/json' },
      timeout: 5_000,
    });
    log?.info?.(`[IntClaw][Emotion] 撤回表情成功: msgId=${data.msgId}`);
  } catch (err: any) {
    log?.warn?.(`[IntClaw][Emotion] 撤回表情失败（不影响主流程）: ${err.message}`);
  }
}
