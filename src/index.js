/**
 * IntClaw Channel Plugin for OpenClaw
 *
 * This plugin provides a WebSocket-based channel for connecting to IntClaw services.
 * It handles bidirectional message flow between OpenClaw and IntClaw servers.
 */

import { IntClawChannel } from './channel/IntClawChannel.js';

/**
 * Register the IntClaw channel with OpenClaw
 * @param {Object} gateway - OpenClaw gateway instance
 * @param {Object} config - Channel configuration
 * @returns {Promise<void>}
 */
export async function registerChannel(gateway, config) {
  const channel = new IntClawChannel(gateway, config);
  await channel.start();
}

/**
 * Plugin initialization function (OpenClaw entry point)
 * @param {Object} gateway - OpenClaw gateway instance
 * @param {Object} config - Plugin configuration
 * @returns {Promise<void>}
 */
export async function register(gateway, config) {
  // Skip if explicitly disabled
  if (config?.enabled === false) {
    return;
  }

  // Skip if required configuration is missing (plugin not configured yet)
  if (!config?.wsUrl || !config?.apiKey) {
    console.log('[IntClaw] Plugin installed but not configured yet. Run "claw setup intclaw" to configure.');
    return;
  }

  await registerChannel(gateway, config);
}
