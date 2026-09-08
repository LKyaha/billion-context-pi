import { test } from "node:test";
import assert from "node:assert/strict";
import reasoningExtension from "../src/reasoning-entry.js";
import { createAcpExtension } from "../src/index.js";

function captureApi() {
  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
  const tools: Array<{ name: string }> = [];
  const commands = new Map<string, unknown>();
  const api = {
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
    registerTool(tool: { name: string }) {
      tools.push(tool);
    },
    registerCommand(name: string, options: unknown) {
      commands.set(name, options);
    },
  };
  return { api, handlers, tools, commands };
}

function withProxyEnvCleared<T>(fn: () => T): T {
  const previous = process.env.BILLION_CONTEXT_PROXY;
  delete process.env.BILLION_CONTEXT_PROXY;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.BILLION_CONTEXT_PROXY;
    else process.env.BILLION_CONTEXT_PROXY = previous;
  }
}

test("default reasoning entry registers ACP and reasoning tools", () => {
  withProxyEnvCleared(() => {
    const { api, tools } = captureApi();
    reasoningExtension(api as never);
    const names = tools.map((tool) => tool.name);
    assert.ok(names.includes("compress"));
    assert.ok(names.includes("decompress"));
    assert.ok(names.includes("search_context"));
    assert.ok(names.includes("acp_status"));
    assert.ok(names.includes("checkpoint_reasoning"));
    assert.ok(names.includes("search_reasoning"));
  });
});

test("named createAcpExtension remains reasoning-free", () => {
  withProxyEnvCleared(() => {
    const { api, tools } = captureApi();
    createAcpExtension()(api as never);
    const names = tools.map((tool) => tool.name);
    assert.ok(names.includes("compress"));
    assert.ok(names.includes("decompress"));
    assert.ok(names.includes("search_context"));
    assert.ok(names.includes("acp_status"));
    assert.ok(!names.includes("checkpoint_reasoning"));
    assert.ok(!names.includes("search_reasoning"));
  });
});
