/**
 * ---
 * status: active
 * birth_time: "2026-03-19T09:42:00Z"
 * original_intent: "Entry point for IntClaw plugin"
 * version_count: 6
 * ---
 */

import { intclawChannel } from './channel/intclaw_channel.js';

let runtime = null;

export function getRuntime() {
  if (!runtime) throw new Error('runtime not initialized');
  return runtime;
}

const plugin = {
  id: 'intclaw',
  name: 'IntClaw Channel',
  description: 'IntClaw bidirectional WebSocket channel for OpenClaw',
  configSchema: {
    type: 'object',
    additionalProperties: true,
    properties: { enabled: { type: 'boolean', default: true } },
  },

  register(api) {
    runtime = api.runtime;
    let logger = runtime.logging?.getChildLogger(this.id)
    logger?.info("[intclaw]插件启动")
    let configData = runtime.config.loadConfig()?.plugins?.entries?.intclaw?.config
    if (configData?.enabled) {
      logger?.info("[intclaw]雇佣通道启动")
      api.registerChannel({ plugin: intclawChannel });
    }
    if (configData?.cloudTwin && configData?.appKey && configData?.appSecret) {
      // todo 开启长轮训等待上传数据通知
      logger?.info("[intclaw]云分身启动")
    }
  },
};

export default plugin;
export { intclawChannel };