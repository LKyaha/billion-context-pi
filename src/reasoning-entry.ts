import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import baseExtension from "./index.js";
import { CONFIG_DIR_NAME } from "./config-dir.js";
import { isUnsupportedHost } from "./host.js";
import { isBiliProxyBaseUrl } from "./proxy-detect.js";
import { ReasoningStore } from "./reasoning-memory.js";
import { appendReasoningLedgerPrompt } from "./reasoning-prompt.js";
import { makeCheckpointReasoningTool, makeSearchReasoningTool } from "./reasoning-tools.js";

const extension: ExtensionFactory = (pi) => {
  baseExtension(pi);
  if (process.env.BILLION_CONTEXT_PROXY || userConfigDisabled(process.cwd())) return;

  const store = new ReasoningStore();
  pi.on("before_agent_start", (event, ctx) => {
    if (isUnsupportedHost(ctx.sessionManager)) return;
    if (isBiliProxyBaseUrl((ctx.model as { baseUrl?: string } | undefined)?.baseUrl)) return;
    return { systemPrompt: appendReasoningLedgerPrompt(event.systemPrompt) };
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
      // Missing/bad config has the same meaning as upstream: not disabled.
    }
  }
  return disabled === false;
}

export * from "./index.js";
export default extension;
