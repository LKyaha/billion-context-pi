import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { defaultPrompts } from "acp-kernel";
import { ReasoningStore } from "../src/reasoning-memory.js";
import {
  makeCheckpointReasoningTool,
  makeSearchReasoningTool,
  parseReasoningList,
} from "../src/reasoning-tools.js";
import { buildAcpSystemPrompt } from "../src/system-prompt.js";

function fakeCtx(sessionFile: string) {
  return {
    sessionManager: {
      buildContextEntries: () => [],
      getSessionId: () => "reasoning-tool-session",
      getSessionFile: () => sessionFile,
    },
  };
}

function resultText(result: { content: unknown[] }): string {
  const first = result.content[0] as { type?: string; text?: string } | undefined;
  return first?.text ?? "";
}

test("parseReasoningList accepts bullets, semicolons, JSON arrays, and tag commas", () => {
  assert.deepEqual(
    parseReasoningList("- first hypothesis\n2. second hypothesis; third hypothesis"),
    ["first hypothesis", "second hypothesis", "third hypothesis"],
  );
  assert.deepEqual(
    parseReasoningList('["4096 OOM", "2048 passes", "4096 OOM"]'),
    ["4096 OOM", "2048 passes"],
  );
  assert.deepEqual(
    parseReasoningList("Qwen3.8, scheduler.py；OOM", true),
    ["Qwen3.8", "scheduler.py", "OOM"],
  );
});

test("checkpoint_reasoning persists state and search_reasoning retrieves rationale", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reasoning-tools-"));
  const sessionFile = path.join(dir, "session.jsonl");
  const ctx = fakeCtx(sessionFile);
  const store = new ReasoningStore();
  const checkpointTool = makeCheckpointReasoningTool(store);
  const searchTool = makeSearchReasoningTool(store);

  const saved = await checkpointTool.execute(
    "tc1",
    {
      topic: "Qwen 128K OOM",
      goal: "Find the source of the prefill memory spike",
      hypotheses: "prefill temporary tensors cause the peak; KV cache growth",
      evidence: "4096 chunk OOM\n2048 chunk passes",
      eliminated: "KV cache is the primary cause — allocation does not grow with the spike",
      decisions: "Keep 128K context; lower prefill floor to 2048",
      openQuestions: "Does 1024 reduce memory enough to justify throughput loss?",
      nextSteps: "Benchmark 1024 / 2048 / 4096",
      tags: "Qwen3.8, scheduler.py, prefill",
    },
    undefined,
    undefined,
    ctx as never,
  );
  assert.match(resultText(saved), /r00001/);
  assert.match(resultText(saved), /Qwen 128K OOM/);

  const found = await searchTool.execute(
    "tc2",
    { query: "prefill 2048 scheduler.py" },
    undefined,
    undefined,
    ctx as never,
  );
  const text = resultText(found);
  assert.match(text, /r00001/);
  assert.match(text, /lower prefill floor to 2048/);
  assert.match(text, /4096 chunk OOM/);
  assert.match(text, /Benchmark 1024 \/ 2048 \/ 4096/);

  await rm(dir, { recursive: true, force: true });
});

test("search_reasoning reports no match without dumping unrelated checkpoints", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reasoning-tools-empty-"));
  const sessionFile = path.join(dir, "session.jsonl");
  const ctx = fakeCtx(sessionFile);
  const store = new ReasoningStore();
  await store.append(sessionFile, "reasoning-tool-session", {
    topic: "Database migration",
    goal: "Choose migration order",
    decisions: ["migrate schema before backfill"],
  });

  const searchTool = makeSearchReasoningTool(store);
  const result = await searchTool.execute(
    "tc3",
    { query: "GPU tensor parallel" },
    undefined,
    undefined,
    ctx as never,
  );
  assert.equal(resultText(result), 'No reasoning checkpoints matched "GPU tensor parallel".');
  await rm(dir, { recursive: true, force: true });
});

test("ACP system prompt documents reasoning memory without requiring checkpoints for routine compression", () => {
  const prompt = buildAcpSystemPrompt(defaultPrompts);
  assert.match(prompt, /checkpoint_reasoning/);
  assert.match(prompt, /search_reasoning/);
  assert.match(prompt, /Before compressing a range that contains important root-cause analysis/);
  assert.match(prompt, /Do NOT checkpoint routine logs/);
  assert.match(prompt, /not raw chain-of-thought/);
});
