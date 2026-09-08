import { Type, type Static } from "typebox";
import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { isPiHost } from "./runtime.js";
import { OMP_UNSUPPORTED_MESSAGE } from "./omp.js";
import {
  ReasoningStore,
  type ReasoningCheckpoint,
  type ReasoningCheckpointInput,
  type ReasoningSearchResult,
} from "./reasoning-memory.js";
import { logThrow } from "./log.js";

const CheckpointParams = Type.Object({
  topic: Type.String({
    minLength: 1,
    maxLength: 160,
    description: "Short topic label for this reasoning milestone.",
  }),
  goal: Type.String({
    minLength: 1,
    maxLength: 2000,
    description: "The current objective or question this checkpoint is trying to resolve.",
  }),
  hypotheses: Type.Optional(Type.String({
    maxLength: 8000,
    description: "Current hypotheses, one per line or separated by semicolons. Store concise claims, not raw chain-of-thought.",
  })),
  evidence: Type.Optional(Type.String({
    maxLength: 12000,
    description: "Observed facts, tests, code findings, errors, benchmarks, or other evidence; one item per line or semicolon.",
  })),
  eliminated: Type.Optional(Type.String({
    maxLength: 8000,
    description: "Rejected hypotheses or approaches and the short reason each was ruled out; one item per line or semicolon.",
  })),
  decisions: Type.Optional(Type.String({
    maxLength: 8000,
    description: "Durable decisions already made and the rationale that must survive context compression; one item per line or semicolon.",
  })),
  openQuestions: Type.Optional(Type.String({
    maxLength: 8000,
    description: "Important unresolved questions; one item per line or semicolon.",
  })),
  nextSteps: Type.Optional(Type.String({
    maxLength: 8000,
    description: "Concrete next actions; one item per line or semicolon.",
  })),
  tags: Type.Optional(Type.String({
    maxLength: 1000,
    description: "Optional comma-, newline-, or semicolon-separated search tags such as file names, subsystem names, model names, or issue ids.",
  })),
});

type CheckpointArgs = Static<typeof CheckpointParams>;

const SearchReasoningParams = Type.Object({
  query: Type.String({ minLength: 1, description: "Keywords describing the prior rationale, decision, root cause, experiment, file, or topic to recover." }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: "Maximum results (default 10)." })),
});

type SearchReasoningArgs = Static<typeof SearchReasoningParams>;

export function makeCheckpointReasoningTool(store: ReasoningStore): ToolDefinition<typeof CheckpointParams> {
  return {
    name: "checkpoint_reasoning",
    label: "Checkpoint Reasoning",
    description:
      "Persist a compact, structured reasoning milestone outside the active context: goal, hypotheses, evidence, rejected paths, decisions, open questions, and next steps. Use for durable rationale, not raw chain-of-thought.",
    promptSnippet: 'checkpoint_reasoning({ topic: "OOM root cause", goal: "Explain the 128K prefill OOM", evidence: "4096 chunk OOM; 2048 passes", decisions: "Keep 128K context; lower prefill chunk" })',
    promptGuidelines: [
      "Checkpoint when a root cause is found, an architecture choice is made, a hypothesis is ruled out, or a long investigation reaches a durable milestone.",
      "Before compressing decision-rich investigation history, checkpoint the durable WHY if it is not already captured.",
      "Do not checkpoint routine logs, repeated unchanged state, or private/raw chain-of-thought.",
      "Keep entries concise and inspectable: hypothesis → evidence → elimination → decision → unresolved → next.",
    ],
    parameters: CheckpointParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<unknown>> {
      if (!isPiHost(ctx.sessionManager)) {
        return { details: undefined, content: [{ type: "text", text: OMP_UNSUPPORTED_MESSAGE }] };
      }
      const args = params as CheckpointArgs;
      try {
        const checkpoint = await store.append(
          ctx.sessionManager.getSessionFile() ?? undefined,
          ctx.sessionManager.getSessionId(),
          checkpointInput(args),
        );
        return {
          details: undefined,
          content: [{ type: "text", text: formatSavedCheckpoint(checkpoint) }],
        };
      } catch (error) {
        logThrow("reasoning", error, {
          sid: ctx.sessionManager.getSessionId(),
          phase: "checkpoint",
          topic: args.topic,
        });
        throw error;
      }
    },
  };
}

export function makeSearchReasoningTool(store: ReasoningStore): ToolDefinition<typeof SearchReasoningParams> {
  return {
    name: "search_reasoning",
    label: "Search Reasoning",
    description:
      "Search durable reasoning checkpoints by topic, decision, evidence, rejected hypothesis, unresolved question, next step, tag, file name, or numeric value. Use to recover WHY before reopening broad historical context.",
    promptSnippet: 'search_reasoning({ query: "prefill 2048 OOM" })',
    promptGuidelines: [
      "Use when resuming old work or when a compressed summary tells you what happened but not why.",
      "Prefer this over broad decompression when you only need prior rationale, eliminated paths, or next actions.",
    ],
    parameters: SearchReasoningParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<unknown>> {
      if (!isPiHost(ctx.sessionManager)) {
        return { details: undefined, content: [{ type: "text", text: OMP_UNSUPPORTED_MESSAGE }] };
      }
      const args = params as SearchReasoningArgs;
      try {
        const results = await store.search(
          ctx.sessionManager.getSessionFile() ?? undefined,
          ctx.sessionManager.getSessionId(),
          args.query,
          args.limit ?? 10,
        );
        return {
          details: undefined,
          content: [{ type: "text", text: formatSearchResults(args.query, results) }],
        };
      } catch (error) {
        logThrow("reasoning", error, {
          sid: ctx.sessionManager.getSessionId(),
          phase: "search",
          query: args.query,
        });
        throw error;
      }
    },
  };
}

export function parseReasoningList(value: string | undefined, splitCommas = false): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return dedupe(parsed.filter((item): item is string => typeof item === "string").map(cleanListItem));
      }
    } catch {
    }
  }
  const splitter = splitCommas ? /\r?\n|[;；,，]+/ : /\r?\n|[;；]+/;
  return dedupe(trimmed.split(splitter).map(cleanListItem));
}

function checkpointInput(args: CheckpointArgs): ReasoningCheckpointInput {
  return {
    topic: args.topic,
    goal: args.goal,
    hypotheses: parseReasoningList(args.hypotheses),
    evidence: parseReasoningList(args.evidence),
    eliminated: parseReasoningList(args.eliminated),
    decisions: parseReasoningList(args.decisions),
    openQuestions: parseReasoningList(args.openQuestions),
    nextSteps: parseReasoningList(args.nextSteps),
    tags: parseReasoningList(args.tags, true),
  };
}

function cleanListItem(value: string): string {
  return value
    .trim()
    .replace(/^(?:[-*•]+|\d+[.)])\s*/, "")
    .replace(/\s+/g, " ");
}

function dedupe(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function formatSavedCheckpoint(checkpoint: ReasoningCheckpoint): string {
  const counts = [
    checkpoint.hypotheses.length ? `${checkpoint.hypotheses.length} hypotheses` : "",
    checkpoint.evidence.length ? `${checkpoint.evidence.length} evidence` : "",
    checkpoint.eliminated.length ? `${checkpoint.eliminated.length} eliminated` : "",
    checkpoint.decisions.length ? `${checkpoint.decisions.length} decisions` : "",
    checkpoint.openQuestions.length ? `${checkpoint.openQuestions.length} open` : "",
    checkpoint.nextSteps.length ? `${checkpoint.nextSteps.length} next` : "",
  ].filter(Boolean).join(", ");
  return `Reasoning checkpoint ${checkpoint.id} saved: "${checkpoint.topic}"${counts ? ` (${counts})` : ""}.`;
}

function formatSearchResults(query: string, results: readonly ReasoningSearchResult[]): string {
  if (results.length === 0) return `No reasoning checkpoints matched "${query}".`;
  const lines = [`Found ${results.length} reasoning checkpoint(s) for "${query}":`];
  for (const result of results) {
    const checkpoint = result.checkpoint;
    lines.push("", `${checkpoint.id} score:${result.score.toFixed(1)} "${checkpoint.topic}"`);
    lines.push(`  Goal: ${truncate(checkpoint.goal, 320)}`);
    appendList(lines, "Decisions", checkpoint.decisions);
    appendList(lines, "Evidence", checkpoint.evidence);
    appendList(lines, "Eliminated", checkpoint.eliminated);
    appendList(lines, "Open", checkpoint.openQuestions);
    appendList(lines, "Next", checkpoint.nextSteps);
    if (checkpoint.tags.length > 0) lines.push(`  Tags: ${checkpoint.tags.join(", ")}`);
  }
  return lines.join("\n");
}

function appendList(lines: string[], label: string, values: readonly string[]): void {
  if (values.length === 0) return;
  const rendered = values.slice(0, 4).map((value) => truncate(value, 240)).join(" | ");
  const suffix = values.length > 4 ? ` | … +${values.length - 4}` : "";
  lines.push(`  ${label}: ${rendered}${suffix}`);
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
