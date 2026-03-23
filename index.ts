/**
 * IntClaw Connector Plugin for OpenClaw
 *
 * IntClaw企业内部机器人插件，使用 Stream 模式连接，支持 AI Card 流式响应。
 * 已迁移到 OpenClaw SDK，支持多账号、安全策略等完整功能。
 * 
 * Last updated: 2026-03-18 17:00:00
 */

/**
 * IntClaw Connector Plugin for OpenClaw
 * 
 * 注意：本插件使用专用的 HTTP 客户端（见 src/utils/http-client.ts）
 * 不会影响 OpenClaw Gateway 和其他插件的网络请求
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { intclawPlugin } from "./src/channel.ts";
import { setIntclawRuntime } from "./src/runtime.ts";
import { registerGatewayMethods } from "./src/gateway-methods.ts";

export default function register(api: OpenClawPluginApi) {
  setIntclawRuntime(api.runtime);
  api.registerChannel({ plugin: intclawPlugin });
  
  // 注册 Gateway Methods
  registerGatewayMethods(api);
}
