import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  ReasoningStore,
  normalizeCheckpointInput,
  searchReasoning,
  type ReasoningCheckpoint,
} from "../src/reasoning-memory.js";

function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "reasoning-memory-"));
}

function input(topic: string, goal = "Understand the current problem") {
  return {
    topic,
    goal,
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
  const header = {
    type: "session",
    version: 3,
    id: path.basename(file),
    timestamp: new Date().toISOString(),
    cwd: "/tmp",
    ...(parentSession ? { parentSession } : {}),
  };
  await writeFile(file, `${JSON.stringify(header)}\n`, "utf8");
}

test("reasoning store starts empty", async () => {
  const dir = await tempDir();
  const sessionFile = path.join(dir, "session.jsonl");
  const store = new ReasoningStore();
  const state = await store.load(sessionFile, "sid");
  assert.equal(state.version, 1);
  assert.equal(state.nextCheckpointId, 1);
  assert.deepEqual(state.checkpoints, []);
  await rm(dir, { recursive: true, force: true });
});

test("append persists and reloads a structured checkpoint", async () => {
  const dir = await tempDir();
  const sessionFile = path.join(dir, "session.jsonl");
  const store = new ReasoningStore();
  const saved = await store.append(sessionFile, "sid", input("128K OOM"));

  assert.equal(saved.id, "r00001");
  assert.deepEqual(saved.decisions, ["keep 128K context", "lower prefill floor to 2048"]);

  const raw = JSON.parse(await readFile(`${sessionFile}.reasoning.json`, "utf8")) as {
    version: number;
    nextCheckpointId: number;
    checkpoints: Array<{ id: string }>;
  };
  assert.equal(raw.version, 1);
  assert.equal(raw.nextCheckpointId, 2);
  assert.equal(raw.checkpoints[0]!.id, "r00001");

  const reloaded = await new ReasoningStore().load(sessionFile, "sid");
  assert.equal(reloaded.checkpoints.length, 1);
  assert.equal(reloaded.checkpoints[0]!.topic, "128K OOM");
  assert.equal(reloaded.nextCheckpointId, 2);
  await rm(dir, { recursive: true, force: true });
});

test("exact duplicate checkpoints are skipped without consuming a new id", async () => {
  const dir = await tempDir();
  const sessionFile = path.join(dir, "dedupe.jsonl");
  const store = new ReasoningStore();

  const first = await store.appendWithStatus(sessionFile, "dedupe", input(" 128K   OOM "));
  const second = await store.appendWithStatus(sessionFile, "dedupe", input("128K OOM"));

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.checkpoint.id, first.checkpoint.id);

  const reloaded = await new ReasoningStore().load(sessionFile, "dedupe");
  assert.equal(reloaded.checkpoints.length, 1);
  assert.equal(reloaded.nextCheckpointId, 2);
  assert.equal(reloaded.checkpoints[0]!.topic, "128K OOM");
  await rm(dir, { recursive: true, force: true });
});

test("parallel appends serialize ids and preserve every checkpoint", async () => {
  const dir = await tempDir();
  const sessionFile = path.join(dir, "parallel.jsonl");
  const store = new ReasoningStore();

  const saved = await Promise.all([
    store.append(sessionFile, "parallel", input("First")),
    store.append(sessionFile, "parallel", input("Second")),
    store.append(sessionFile, "parallel", input("Third")),
  ]);

  assert.deepEqual(saved.map((checkpoint) => checkpoint.id), ["r00001", "r00002", "r00003"]);
  const reloaded = await new ReasoningStore().load(sessionFile, "parallel");
  assert.deepEqual(reloaded.checkpoints.map((checkpoint) => checkpoint.id), ["r00001", "r00002", "r00003"]);
  assert.deepEqual(reloaded.checkpoints.map((checkpoint) => checkpoint.topic), ["First", "Second", "Third"]);
  assert.equal(reloaded.nextCheckpointId, 4);
  await rm(dir, { recursive: true, force: true });
});

test("file-less sessions persist in memory and remain isolated by session id", async () => {
  const store = new ReasoningStore();
  await store.append(undefined, "sid-A", input("A"));
  await store.append(undefined, "sid-B", input("B"));
  await store.append(undefined, "sid-A", input("A second"));

  const a = await store.load(undefined, "sid-A");
  const b = await store.load(undefined, "sid-B");
  assert.deepEqual(a.checkpoints.map((checkpoint) => checkpoint.id), ["r00001", "r00002"]);
  assert.deepEqual(a.checkpoints.map((checkpoint) => checkpoint.topic), ["A", "A second"]);
  assert.deepEqual(b.checkpoints.map((checkpoint) => checkpoint.topic), ["B"]);
});

test("child session inherits parent reasoning and continues checkpoint ids", async () => {
  const dir = await tempDir();
  const parent = path.join(dir, "parent.jsonl");
  const child = path.join(dir, "child.jsonl");
  await writeSessionHeader(parent);
  await writeSessionHeader(child, parent);

  const parentStore = new ReasoningStore();
  await parentStore.append(parent, "parent", input("Parent decision"));

  const childStore = new ReasoningStore();
  const inherited = await childStore.load(child, "child");
  assert.equal(inherited.checkpoints.length, 1);
  assert.equal(inherited.checkpoints[0]!.topic, "Parent decision");
  assert.equal(inherited.nextCheckpointId, 2);

  const childCheckpoint = await childStore.append(child, "child", input("Child follow-up"));
  assert.equal(childCheckpoint.id, "r00002");

  const childReloaded = await new ReasoningStore().load(child, "child");
  assert.deepEqual(childReloaded.checkpoints.map((checkpoint) => checkpoint.topic), ["Parent decision", "Child follow-up"]);
  await rm(dir, { recursive: true, force: true });
});

test("parent chain skips missing intermediate reasoning sidecars", async () => {
  const dir = await tempDir();
  const grandparent = path.join(dir, "grandparent.jsonl");
  const parent = path.join(dir, "parent.jsonl");
  const child = path.join(dir, "child.jsonl");
  await writeSessionHeader(grandparent);
  await writeSessionHeader(parent, grandparent);
  await writeSessionHeader(child, parent);

  await new ReasoningStore().append(grandparent, "grandparent", input("Grandparent root cause"));
  const inherited = await new ReasoningStore().load(child, "child");
  assert.equal(inherited.checkpoints.length, 1);
  assert.equal(inherited.checkpoints[0]!.topic, "Grandparent root cause");
  await rm(dir, { recursive: true, force: true });
});

test("checkpoint normalization trims whitespace and removes duplicate list items", () => {
  const normalized = normalizeCheckpointInput({
    topic: "  OOM   analysis  ",
    goal: " find   the\nroot cause ",
    evidence: [" 4096 OOM ", "4096 OOM", "", " 2048 passes  "],
  });
  assert.equal(normalized.topic, "OOM analysis");
  assert.equal(normalized.goal, "find the root cause");
  assert.deepEqual(normalized.evidence, ["4096 OOM", "2048 passes"]);
});

test("reasoning search ranks decision and numeric matches above unrelated checkpoints", () => {
  const now = Date.now();
  const checkpoints: ReasoningCheckpoint[] = [
    {
      id: "r00001",
      createdAt: now,
      topic: "KV cache theory",
      goal: "Check whether KV cache growth explains the failure",
      hypotheses: ["KV cache grows too quickly"],
      evidence: ["context is 128K"],
      eliminated: [],
      decisions: ["inspect cache allocation"],
      openQuestions: [],
      nextSteps: [],
      tags: ["cache"],
    },
    {
      id: "r00002",
      createdAt: now + 1,
      topic: "Prefill OOM root cause",
      goal: "Find the prefill memory spike",
      hypotheses: ["temporary tensors peak during prefill"],
      evidence: ["4096 chunk OOM", "2048 chunk passes"],
      eliminated: ["KV cache is the primary cause"],
      decisions: ["set prefill floor to 2048"],
      openQuestions: ["1024 throughput cost"],
      nextSteps: ["benchmark 1024 2048 4096"],
      tags: ["scheduler.py", "Qwen3.8"],
    },
  ];

  const results = searchReasoning(checkpoints, "为什么 2048 prefill", 10);
  assert.equal(results[0]!.checkpoint.id, "r00002");
  assert.ok(results[0]!.score > 0);
  assert.equal(searchReasoning(checkpoints, "nonexistent phrase", 10).length, 0);
});
