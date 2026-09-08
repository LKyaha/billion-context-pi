import { CONFIG_DIR_NAME, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import baseExtension from "./index.js";
import { ReasoningStore } from "./reasoning-memory.js";
import { appendReasoningMemoryPrompt } from "./reasoning-prompt.js";
import { makeCheckpointReasoningTool, makeSearchReasoningTool } from "./reasoning-tools.js";
import { isPiHost } from "./runtime.js";

const extension: ExtensionFactory = (pi) => {
  baseExtension(pi);
  if (process.env.BILLION_CONTEXT_PROXY || userConfigDisabled(process.cwd())) return;

  const store = new ReasoningStore();
  pi.on("session_start", () => {
    store.invalidate();
  });
  pi.on("before_agent_start", (event, ctx) => {
    if (!isPiHost(ctx.sessionManager)) return;
    return { systemPrompt: appendReasoningMemoryPrompt(event.systemPrompt) };
  });
  pi.registerTool(makeCheckpointReasoningTool(store));
  pi.registerTool(makeSearchReasoningTool(store));
};

function userConfigDisabled(cwd: string): boolean {
  let disabled: boolean | undefined;
  for (const base of [join(homedir(), CONFIG_DIR_NAME), join(cwd, CONFIG_DIR_NAME)]) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(base, "acp.json"), "utf8"));
      if (parsed && typeof parsed === "object") {
        const value = (parsed as Record<string, unknown>).enabled;
        if (value === true || value === false) disabled = value;
      }
    } catch {
    }
  }
  return disabled === false;
}

export * from "./index.js";
export default extension;
