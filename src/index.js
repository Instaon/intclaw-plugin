/**
 * ---
 * status: active
 * birth_time: "2026-03-19T09:42:00Z"
 * original_intent: "Entry point for IntClaw plugin"
 * version_count: 2
 * ---
 */

import { start_intclaw_channel } from './channel/intclaw_channel.js';

export async function register(gateway, config) {
  if (config?.enabled === false) {
    return;
  }

  if (!config?.appKey || !config?.appSecret) {
    console.log(JSON.stringify({ error: "missing_config_keys" }));
    return;
  }

  await start_intclaw_channel(gateway, config);
}
