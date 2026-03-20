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
    console.log("[intclaw插件启动]",runtime.config.loadConfig())
    api.registerChannel({ plugin: intclawChannel });
  },
};

export default plugin;
export { intclawChannel };