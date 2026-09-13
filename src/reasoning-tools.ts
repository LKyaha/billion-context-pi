import { Type, type Static } from "typebox";
import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { isUnsupportedHost } from "./host.js";
import { UNSUPPORTED_HOST_MESSAGE } from "./omp.js";
import { isBiliProxyBaseUrl, PROXY_STAND_DOWN_MESSAGE } from "./proxy-detect.js";
import { debug, logThrow, logWarn } from "./log.js";
import { countUnicodeEscapes, findUnverifiableUserQuote, sanitizeSummary } from "./summary-sanitize.js";
import {
  ReasoningStore,
  type ReasoningCheckpoint,
  type ReasoningCheckpointInput,
  type ReasoningSearchResult,
} from "./reasoning-memory.js";

const CheckpointParams = Type.Object({
  topic: Type.String({ minLength: 1, maxLength: 160, description: "Short label for this durable reasoning milestone." }),
  goal: Type.String({ minLength: 1, maxLength: 2000, description: "Objective or question this checkpoint is resolving." }),
  hypotheses: Type.Optional(Type.String({ maxLength: 8000, description: "Current hypotheses; newline or semicolon separated." })),
  evidence: Type.Optional(Type.String({ maxLength: 12000, description: "Observed facts/tests/code findings; newline or semicolon separated." })),
  eliminated: Type.Optional(Type.String({ maxLength: 8000, description: "Rejected hypotheses/approaches with short reasons." })),
  decisions: Type.Optional(Type.String({ maxLength: 8000, description: "Durable decisions with rationale." })),
  openQuestions: Type.Optional(Type.String({ maxLength: 8000, description: "Important unresolved questions." })),
  nextSteps: Type.Optional(Type.String({ maxLength: 8000, description: "Concrete next actions." })),
  tags: Type.Optional(Type.String({ maxLength: 1000, description: "Optional comma/newline/semicolon search tags." })),
});

type CheckpointArgs = Static<typeof CheckpointParams>;

const SearchReasoningParams = Type.Object({
  query: Type.String({ minLength: 1, description: "Keywords for prior rationale, decision, root cause, experiment, file, or topic." }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: "Maximum results (default 10)." })),
});

type SearchReasoningArgs = Static<typeof SearchReasoningParams>;

export function makeCheckpointReasoningTool(store: ReasoningStore): ToolDefinition<typeof CheckpointParams> {
  return {
    name: "checkpoint_reasoning",
    label: "Checkpoint Reasoning",
    description: "Persist a sparse, structured reasoning milestone that should survive later ACP distillation. Store durable rationale, not raw chain-of-thought.",
    promptSnippet: 'checkpoint_reasoning({ topic: "OOM root cause", goal: "Explain 128K prefill OOM", evidence: "4096 chunk OOM; 2048 passes", decisions: "Keep 128K; lower prefill chunk" })',
    promptGuidelines: [
      "Use sparingly for root causes, architecture choices, ruled-out approaches, or experiment conclusions that may matter after tier-2/tier-3 compression.",
      "Do not checkpoint routine logs, unchanged state, credentials, user instructions verbatim, or private/raw chain-of-thought.",
    ],
    parameters: CheckpointParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<unknown>> {
      const standDown = standDownMessage(ctx);
      if (standDown) return textResult(standDown);
      const args = params as CheckpointArgs;
      const sid = ctx.sessionManager.getSessionId();
      try {
        const appended = await store.append(
          ctx.sessionManager.getSessionFile() ?? undefined,
          sid,
          sanitizeCheckpointInput(checkpointInput(args), sid),
        );
        return textResult(formatSavedCheckpoint(appended.checkpoint, appended.created));
      } catch (error) {
        logThrow("reasoning", error, { sid, phase: "checkpoint", topic: args.topic });
        throw error;
      }
    },
  };
}

export function makeSearchReasoningTool(store: ReasoningStore): ToolDefinition<typeof SearchReasoningParams> {
  return {
    name: "search_reasoning",
    label: "Search Reasoning",
    description: "Search durable reasoning checkpoints for WHY: rationale, evidence, eliminated paths, open questions, or next actions.",
    promptSnippet: 'search_reasoning({ query: "prefill 2048 OOM" })',
    promptGuidelines: ["Use when ACP history says what happened but the durable rationale is missing or too condensed."],
    parameters: SearchReasoningParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<unknown>> {
      const standDown = standDownMessage(ctx);
      if (standDown) return textResult(standDown);
      const args = params as SearchReasoningArgs;
      try {
        const results = await store.search(
          ctx.sessionManager.getSessionFile() ?? undefined,
          ctx.sessionManager.getSessionId(),
          args.query,
          args.limit ?? 10,
        );
        return textResult(formatSearchResults(args.query, results));
      } catch (error) {
        logThrow("reasoning", error, { sid: ctx.sessionManager.getSessionId(), phase: "search", query: args.query });
        throw error;
      }
    },
  };
}

function standDownMessage(ctx: { sessionManager: Parameters<typeof isUnsupportedHost>[0]; model?: unknown }): string | undefined {
  if (isUnsupportedHost(ctx.sessionManager)) return UNSUPPORTED_HOST_MESSAGE;
  const baseUrl = (ctx.model as { baseUrl?: string } | undefined)?.baseUrl;
  if (isBiliProxyBaseUrl(baseUrl)) return PROXY_STAND_DOWN_MESSAGE;
  return undefined;
}

function textResult(text: string): AgentToolResult<unknown> {
  return { details: undefined, content: [{ type: "text", text }] };
}

export function parseReasoningList(value: string | undefined, splitCommas = false): string[] {
  if (!value?.trim()) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return dedupe(parsed.filter((item): item is string => typeof item === "string").map(cleanListItem));
    } catch {
      // Fall back to simple separators; non-strict local providers often stringify arrays.
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

function sanitizeCheckpointInput(input: ReasoningCheckpointInput, sid: string): ReasoningCheckpointInput {
  const sanitize = (field: string, value: string): string => {
    const result = sanitizeSummary(value);
    if (result.unescaped) {
      debug.event("reasoning", { sid, event: "checkpoint-unescaped", field, escapes: countUnicodeEscapes(value), beforeLen: value.length, afterLen: result.text.length });
    }
    const quote = findUnverifiableUserQuote(result.text);
    if (quote !== null) logWarn("reasoning", { sid, event: "checkpoint-unverifiable-quote", field, claim: quote });
    return result.text;
  };
  const list = (field: string, values: readonly string[] | undefined): string[] => (values ?? []).map((value) => sanitize(field, value));
  return {
    topic: sanitize("topic", input.topic),
    goal: sanitize("goal", input.goal),
    hypotheses: list("hypotheses", input.hypotheses),
    evidence: list("evidence", input.evidence),
    eliminated: list("eliminated", input.eliminated),
    decisions: list("decisions", input.decisions),
    openQuestions: list("openQuestions", input.openQuestions),
    nextSteps: list("nextSteps", input.nextSteps),
    tags: list("tags", input.tags),
  };
}

function cleanListItem(value: string): string {
  return value.trim().replace(/^(?:[-*•]+|\d+[.)])\s*/, "").replace(/\s+/g, " ");
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function formatSavedCheckpoint(checkpoint: ReasoningCheckpoint, created: boolean): string {
  if (!created) return `Reasoning checkpoint ${checkpoint.id} already captures this unchanged state: "${checkpoint.topic}". Duplicate not added.`;
  return `Reasoning checkpoint ${checkpoint.id} saved: "${checkpoint.topic}".`;
}

function formatSearchResults(query: string, results: readonly ReasoningSearchResult[]): string {
  if (results.length === 0) return `No reasoning checkpoints matched "${query}".`;
  const lines = [`Found ${results.length} reasoning checkpoint(s) for "${query}":`];
  for (const { checkpoint, score } of results) {
    lines.push("", `${checkpoint.id} score:${score.toFixed(1)} "${checkpoint.topic}"`, `  Goal: ${truncate(checkpoint.goal, 320)}`);
    appendList(lines, "Hypotheses", checkpoint.hypotheses);
    appendList(lines, "Decisions", checkpoint.decisions);
    appendList(lines, "Evidence", checkpoint.evidence);
    appendList(lines, "Eliminated", checkpoint.eliminated);
    appendList(lines, "Open", checkpoint.openQuestions);
    appendList(lines, "Next", checkpoint.nextSteps);
    if (checkpoint.tags.length) lines.push(`  Tags: ${checkpoint.tags.join(", ")}`);
  }
  return lines.join("\n");
}

function appendList(lines: string[], label: string, values: readonly string[]): void {
  if (!values.length) return;
  const rendered = values.slice(0, 4).map((value) => truncate(value, 240)).join(" | ");
  lines.push(`  ${label}: ${rendered}${values.length > 4 ? ` | … +${values.length - 4}` : ""}`);
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
