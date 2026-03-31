/**
 * Instagram Claw Connector Plugin Entry
 * 
 * This is the main entry point for the Instagram Claw Connector plugin.
 * It provides the register function that registers the ChannelPlugin with OpenClaw.
 * 
 * Validates: Requirements 1.1, 1.2, 1.3
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { instaClawPlugin } from './channel';

/**
 * Plugin registration function
 * 
 * This is the entry point called by OpenClaw to register the plugin.
 * It registers the ChannelPlugin object which contains all the plugin's
 * metadata, capabilities, configuration schema, and methods.
 * 
 * Validates: Requirements 1.1, 1.2, 1.3
 * 
 * @param api - OpenClaw Plugin API
 */
export default function register(api: OpenClawPluginApi): void {
  // Register the ChannelPlugin with OpenClaw
  api.registerChannel({ plugin: instaClawPlugin });
  
  console.log('[InstaClawConnector] Plugin registered successfully');
}
