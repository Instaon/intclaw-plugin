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
 * Plugin initialization function
 * @param {Object} gateway - OpenClaw gateway instance
 * @param {Object} config - Plugin configuration
 * @returns {Promise<void>}
 */
export async function init(gateway, config) {
  if (config.enabled !== false) {
    await registerChannel(gateway, config);
  }
}
