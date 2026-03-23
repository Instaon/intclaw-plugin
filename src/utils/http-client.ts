/**
 * HTTP 客户端配置模块
 * 
 * 提供统一的 axios 实例，禁用代理以避免系统 PAC 文件影响
 * 
 * 问题背景：
 * - 阿里巴巴内网 PAC 文件会将 *.intclaw.com 路由到内网代理（如 192.168.1.176:443）
 * - 当不在内网环境时，会导致连接超时
 * 
 * 解决方案：
 * - 创建专用的 axios 实例，禁用代理
 * - 仅影响IntClaw插件，不影响 OpenClaw Gateway 和其他插件
 * 
 * 使用方式：
 * ```typescript
 * import { intclawHttp } from './utils/http-client.ts';
 * 
 * const response = await intclawHttp.post('/api/endpoint', data);
 * ```
 */

import axios, { type AxiosInstance, type CreateAxiosDefaults } from 'axios';

/**
 * 获取代理配置
 * 
 * 策略：
 * 1. 如果设置了 INTCLAW_FORCE_PROXY=true，使用环境变量中的代理
 * 2. 否则禁用代理（避免被系统 PAC 影响）
 */
function getProxyConfig(): CreateAxiosDefaults['proxy'] {
  // 如果强制启用代理
  if (process.env.INTCLAW_FORCE_PROXY === 'true') {
    const proxyUrl =
      process.env.https_proxy ||
      process.env.HTTPS_PROXY ||
      process.env.http_proxy ||
      process.env.HTTP_PROXY;

    if (proxyUrl) {
      return proxyUrl as any;
    }
  }

  // 默认禁用代理
  return false;
}

/**
 * IntClaw专用 HTTP 客户端
 * 
 * 特性：
 * - 禁用代理（避免 PAC 文件影响）
 * - 30 秒超时
 * - 仅影响IntClaw插件的请求
 */
export const intclawHttp: AxiosInstance = axios.create({
  proxy: getProxyConfig(),
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * IntClaw OAPI 专用 HTTP 客户端（用于媒体上传等）
 */
export const intclawOapiHttp: AxiosInstance = axios.create({
  proxy: getProxyConfig(),
  timeout: 60000, // 媒体上传可能需要更长时间
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * 用于文件上传的 HTTP 客户端（支持 multipart/form-data）
 */
export const intclawUploadHttp: AxiosInstance = axios.create({
  proxy: getProxyConfig(),
  timeout: 120000, // 文件上传需要更长时间
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
});
