import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import baseExtension from "./index.js";
import { ReasoningStore } from "./reasoning-memory.js";
import { makeCheckpointReasoningTool, makeSearchReasoningTool } from "./reasoning-tools.js";

const extension: ExtensionFactory = (pi) => {
  baseExtension(pi);
  if (process.env.BILLION_CONTEXT_PROXY) return;

  const store = new ReasoningStore();
  pi.on("session_start", () => {
    store.invalidate();
  });
  pi.registerTool(makeCheckpointReasoningTool(store));
  pi.registerTool(makeSearchReasoningTool(store));
};

export * from "./index.js";
export default extension;
