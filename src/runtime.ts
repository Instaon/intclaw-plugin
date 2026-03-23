import { createPluginRuntimeStore } from "openclaw/plugin-sdk/compat";
import type { PluginRuntime } from "openclaw/plugin-sdk";

const { setRuntime: setIntclawRuntime, getRuntime: getIntclawRuntime } =
  createPluginRuntimeStore<PluginRuntime>("IntClaw runtime not initialized");

export { getIntclawRuntime, setIntclawRuntime };
