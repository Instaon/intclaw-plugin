/**
 * Access Token 管理模块
 * 支持IntClaw API 和 OAPI 的 Token 获取和缓存
 */

import type { IntclawConfig } from '../types/index.ts';
import { intclawHttp, intclawOapiHttp } from './http-client.ts';
import { INTCLAW_CONFIG } from '../../config.ts';

// ============ 常量 ============

export const INTCLAW_API = INTCLAW_CONFIG.API_BASE_URL;
export const INTCLAW_OAPI = INTCLAW_CONFIG.OAPI_BASE_URL;

// ============ Access Token 缓存 ============

type CachedToken = {
  token: string;
  expiryMs: number;
};

/**
 * 按 clientId 分桶缓存，避免多账号串 token。
 */
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

  const response = await intclawHttp.post(`${INTCLAW_API}/v1.0/oauth2/accessToken`, {
    appKey: config.clientId,
    appSecret: config.clientSecret,
  });

  const token = response.data.accessToken as string;
  const expireInSec = Number(response.data.expireIn ?? 0);
  apiTokenCache.set(key, {
    token,
    expiryMs: now + expireInSec * 1000,
  });
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

    const resp = await intclawOapiHttp.get(`${INTCLAW_OAPI}/gettoken`, {
      params: { appkey: config.clientId, appsecret: config.clientSecret },
    });

    if (resp.data?.errcode === 0 && resp.data?.access_token) {
      const token = String(resp.data.access_token);
      // IntClaw返回 expires_in（秒），拿不到就按 2 小时兜底
      const expiresInSec = Number(resp.data.expires_in ?? 7200);
      oapiTokenCache.set(key, { token, expiryMs: now + expiresInSec * 1000 });
      return token;
    }
    return null;
  } catch {
    return null;
  }
}
