import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import reasoningExtension from "../src/reasoning-entry.js";
import { createAcpExtension } from "../src/index.js";
import { ReasoningStore, searchReasoning, type ReasoningCheckpoint } from "../src/reasoning-memory.js";

function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "reasoning-ledger-"));
}

function checkpointInput(topic: string) {
  return {
    topic,
    goal: "Understand the current problem",
    hypotheses: ["prefill temporary tensors cause the peak"],
    evidence: ["4096 chunk OOM", "2048 chunk passes"],
    eliminated: ["KV cache is the primary cause"],
    decisions: ["keep 128K context", "lower prefill floor to 2048"],
    openQuestions: ["measure 1024 throughput"],
    nextSteps: ["benchmark 1024 / 2048 / 4096"],
    tags: ["Qwen3.8", "scheduler.py"],
  };
}

async function writeSessionHeader(file: string, parentSession?: string): Promise<void> {
  await writeFile(file, `${JSON.stringify({
    type: "session",
    version: 3,
    id: path.basename(file),
    timestamp: new Date().toISOString(),
    cwd: "/tmp",
    ...(parentSession ? { parentSession } : {}),
  })}\n`, "utf8");
}

test("reasoning ledger persists, reloads, and suppresses exact duplicates", async () => {
  const dir = await tempDir();
  try {
    const sessionFile = path.join(dir, "session.jsonl");
    const store = new ReasoningStore();
    const first = await store.append(sessionFile, "sid", checkpointInput("128K OOM"));
    const duplicate = await store.append(sessionFile, "sid", checkpointInput("128K OOM"));

    assert.equal(first.created, true);
    assert.equal(first.checkpoint.id, "r00001");
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.checkpoint.id, "r00001");

    const raw = JSON.parse(await readFile(`${sessionFile}.reasoning.json`, "utf8")) as { nextCheckpointId: number; checkpoints: unknown[] };
    assert.equal(raw.nextCheckpointId, 2);
    assert.equal(raw.checkpoints.length, 1);

    const reloaded = await new ReasoningStore().load(sessionFile, "sid");
    assert.equal(reloaded.checkpoints[0]?.topic, "128K OOM");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("file-less sessions are isolated and retain state in process", async () => {
  const store = new ReasoningStore();
  await store.append(undefined, "A", checkpointInput("A1"));
  await store.append(undefined, "B", checkpointInput("B1"));
  await store.append(undefined, "A", checkpointInput("A2"));
  assert.deepEqual((await store.load(undefined, "A")).checkpoints.map((c) => c.topic), ["A1", "A2"]);
  assert.deepEqual((await store.load(undefined, "B")).checkpoints.map((c) => c.topic), ["B1"]);
});

test("child Pi session inherits parent ledger and continues ids", async () => {
  const dir = await tempDir();
  try {
    const parent = path.join(dir, "parent.jsonl");
    const child = path.join(dir, "child.jsonl");
    await writeSessionHeader(parent);
    await writeSessionHeader(child, parent);
    await new ReasoningStore().append(parent, "parent", checkpointInput("Parent decision"));

    const childStore = new ReasoningStore();
    const inherited = await childStore.load(child, "child");
    assert.equal(inherited.checkpoints[0]?.topic, "Parent decision");
    assert.equal(inherited.nextCheckpointId, 2);

    const childAdded = await childStore.append(child, "child", checkpointInput("Child follow-up"));
    assert.equal(childAdded.checkpoint.id, "r00002");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reasoning search recovers numeric and rationale terms", () => {
  const now = Date.now();
  const checkpoints: ReasoningCheckpoint[] = [
    {
      id: "r00001", createdAt: now, topic: "KV cache theory", goal: "Check cache growth",
      hypotheses: ["KV cache grows too quickly"], evidence: ["context is 128K"], eliminated: [],
      decisions: ["inspect cache allocation"], openQuestions: [], nextSteps: [], tags: ["cache"],
    },
    {
      id: "r00002", createdAt: now + 1, topic: "Prefill OOM root cause", goal: "Find the prefill memory spike",
      hypotheses: ["temporary tensors peak during prefill"], evidence: ["4096 chunk OOM", "2048 chunk passes"],
      eliminated: ["KV cache is the primary cause"], decisions: ["set prefill floor to 2048"],
      openQuestions: ["1024 throughput cost"], nextSteps: ["benchmark 1024 2048 4096"], tags: ["scheduler.py", "Qwen3.8"],
    },
  ];
  const results = searchReasoning(checkpoints, "为什么 2048 prefill");
  assert.equal(results[0]?.checkpoint.id, "r00002");
  assert.equal(searchReasoning(checkpoints, "nonexistent phrase").length, 0);
});

function captureApi() {
  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
  const tools: Array<{ name: string }> = [];
  const commands = new Map<string, unknown>();
  const api = {
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool(tool: { name: string }) { tools.push(tool); },
    registerCommand(name: string, options: unknown) { commands.set(name, options); },
    registerShortcut() {},
  };
  return { api, handlers, tools, commands };
}

function withEnvCleared<T>(fn: () => T): T {
  const proxy = process.env.BILLION_CONTEXT_PROXY;
  const fork = process.env.PI_ACP_FORK_HOST;
  delete process.env.BILLION_CONTEXT_PROXY;
  delete process.env.PI_ACP_FORK_HOST;
  try {
    return fn();
  } finally {
    if (proxy === undefined) delete process.env.BILLION_CONTEXT_PROXY; else process.env.BILLION_CONTEXT_PROXY = proxy;
    if (fork === undefined) delete process.env.PI_ACP_FORK_HOST; else process.env.PI_ACP_FORK_HOST = fork;
  }
}

test("default entry adds only the two ledger tools; named upstream factory stays unchanged", () => {
  withEnvCleared(() => {
    const wrapped = captureApi();
    reasoningExtension(wrapped.api as never);
    const wrappedNames = wrapped.tools.map((tool) => tool.name);
    assert.ok(wrappedNames.includes("compress"));
    assert.ok(wrappedNames.includes("decompress"));
    assert.ok(wrappedNames.includes("search_context"));
    assert.ok(wrappedNames.includes("acp_status"));
    assert.ok(wrappedNames.includes("checkpoint_reasoning"));
    assert.ok(wrappedNames.includes("search_reasoning"));

    const base = captureApi();
    createAcpExtension()(base.api as never);
    const baseNames = base.tools.map((tool) => tool.name);
    assert.ok(!baseNames.includes("checkpoint_reasoning"));
    assert.ok(!baseNames.includes("search_reasoning"));
  });
});

test("ledger prompt stands down on unsupported hosts and bili proxy", () => {
  withEnvCleared(() => {
    const wrapped = captureApi();
    reasoningExtension(wrapped.api as never);
    const handler = (wrapped.handlers.get("before_agent_start") ?? []).at(-1);
    assert.ok(handler);

    const unsupported = handler!({ systemPrompt: "BASE" }, { sessionManager: {}, model: { baseUrl: "https://example.com" } });
    assert.equal(unsupported, undefined);

    const piSessionManager = { buildContextEntries: () => [] };
    const proxied = handler!({ systemPrompt: "BASE" }, {
      sessionManager: piSessionManager,
      model: { baseUrl: "http://127.0.0.1:8787/bili/https://example.com/v1" },
    });
    assert.equal(proxied, undefined);

    const direct = handler!({ systemPrompt: "BASE" }, {
      sessionManager: piSessionManager,
      model: { baseUrl: "https://example.com/v1" },
    }) as { systemPrompt?: string } | undefined;
    assert.match(direct?.systemPrompt ?? "", /REASONING LEDGER/);
  });
});
