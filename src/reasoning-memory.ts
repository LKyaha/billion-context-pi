import { promises as fs } from "node:fs";
import * as path from "node:path";
import { logError, logInfo, logWarn } from "./log.js";
import { readParentSessionPath } from "./state.js";

const REASONING_SUFFIX = ".reasoning.json";
const MAX_PARENT_CHAIN_DEPTH = 8;
const RECENT_DUPLICATE_SCAN = 32;

export interface ReasoningCheckpoint {
  id: string;
  createdAt: number;
  topic: string;
  goal: string;
  hypotheses: string[];
  evidence: string[];
  eliminated: string[];
  decisions: string[];
  openQuestions: string[];
  nextSteps: string[];
  tags: string[];
}

export interface ReasoningCheckpointInput {
  topic: string;
  goal: string;
  hypotheses?: string[];
  evidence?: string[];
  eliminated?: string[];
  decisions?: string[];
  openQuestions?: string[];
  nextSteps?: string[];
  tags?: string[];
}

export interface ReasoningState {
  version: 1;
  nextCheckpointId: number;
  checkpoints: ReasoningCheckpoint[];
}

export interface ReasoningSearchResult {
  checkpoint: ReasoningCheckpoint;
  score: number;
}

function freshState(): ReasoningState {
  return { version: 1, nextCheckpointId: 1, checkpoints: [] };
}

function reasoningFileFor(sessionFile: string | undefined): string | null {
  return sessionFile ? `${sessionFile}${REASONING_SUFFIX}` : null;
}

function cacheKey(sessionFile: string | undefined, sessionId: string): string {
  return sessionFile ? `file:${sessionFile}` : `session:${sessionId}`;
}

function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function cleanList(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = cleanText(value);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

export function normalizeCheckpointInput(input: ReasoningCheckpointInput): ReasoningCheckpointInput {
  return {
    topic: cleanText(input.topic),
    goal: cleanText(input.goal),
    hypotheses: cleanList(input.hypotheses),
    evidence: cleanList(input.evidence),
    eliminated: cleanList(input.eliminated),
    decisions: cleanList(input.decisions),
    openQuestions: cleanList(input.openQuestions),
    nextSteps: cleanList(input.nextSteps),
    tags: cleanList(input.tags),
  };
}

export class ReasoningStore {
  private cache = new Map<string, ReasoningState>();
  private appendTails = new Map<string, Promise<void>>();

  async load(sessionFile: string | undefined, sessionId: string): Promise<ReasoningState> {
    const key = cacheKey(sessionFile, sessionId);
    const cached = this.cache.get(key);
    if (cached) return cached;

    let state = freshState();
    const file = reasoningFileFor(sessionFile);
    if (file) {
      try {
        state = parseReasoningState(JSON.parse(await fs.readFile(file, "utf8")));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          logWarn("reasoning", { event: "load-failed", file, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (state.checkpoints.length === 0 && sessionFile) {
        const inherited = await this.tryLoadParentState(sessionFile);
        if (inherited) state = inherited;
      }
    }

    this.cache.set(key, state);
    return state;
  }

  async append(
    sessionFile: string | undefined,
    sessionId: string,
    input: ReasoningCheckpointInput,
  ): Promise<{ checkpoint: ReasoningCheckpoint; created: boolean }> {
    const normalized = normalizeCheckpointInput(input);
    if (!normalized.topic) throw new Error("Reasoning checkpoint topic must not be empty.");
    if (!normalized.goal) throw new Error("Reasoning checkpoint goal must not be empty.");

    const key = cacheKey(sessionFile, sessionId);
    const release = await this.acquireAppendLock(key);
    try {
      const state = await this.load(sessionFile, sessionId);
      const duplicate = findRecentDuplicate(state.checkpoints, normalized);
      if (duplicate) {
        logInfo("reasoning", { event: "duplicate-skip", checkpointId: duplicate.id, topic: duplicate.topic });
        return { checkpoint: duplicate, created: false };
      }

      const checkpoint: ReasoningCheckpoint = {
        id: `r${String(state.nextCheckpointId).padStart(5, "0")}`,
        createdAt: Date.now(),
        topic: normalized.topic,
        goal: normalized.goal,
        hypotheses: normalized.hypotheses ?? [],
        evidence: normalized.evidence ?? [],
        eliminated: normalized.eliminated ?? [],
        decisions: normalized.decisions ?? [],
        openQuestions: normalized.openQuestions ?? [],
        nextSteps: normalized.nextSteps ?? [],
        tags: normalized.tags ?? [],
      };
      const nextState: ReasoningState = {
        version: 1,
        nextCheckpointId: state.nextCheckpointId + 1,
        checkpoints: [...state.checkpoints, checkpoint],
      };
      await this.save(nextState, sessionFile, sessionId);
      return { checkpoint, created: true };
    } finally {
      release();
    }
  }

  async search(sessionFile: string | undefined, sessionId: string, query: string, limit = 10): Promise<ReasoningSearchResult[]> {
    return searchReasoning((await this.load(sessionFile, sessionId)).checkpoints, query, limit);
  }

  private async acquireAppendLock(key: string): Promise<() => void> {
    const previous = this.appendTails.get(key) ?? Promise.resolve();
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    const tail = previous.then(() => gate);
    this.appendTails.set(key, tail);
    await previous;
    return () => {
      releaseGate();
      if (this.appendTails.get(key) === tail) this.appendTails.delete(key);
    };
  }

  private async save(state: ReasoningState, sessionFile: string | undefined, sessionId: string): Promise<void> {
    const key = cacheKey(sessionFile, sessionId);
    const file = reasoningFileFor(sessionFile);
    if (!file) {
      this.cache.set(key, state);
      return;
    }
    const dir = path.dirname(file);
    const tmp = path.join(dir, `.reasoning-tmp-${path.basename(file)}`);
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(state), "utf8");
      await fs.rename(tmp, file);
      this.cache.set(key, state);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      logError("reasoning", { event: "save-failed", file, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private async tryLoadParentState(sessionFile: string): Promise<ReasoningState | undefined> {
    let current = sessionFile;
    for (let depth = 0; depth < MAX_PARENT_CHAIN_DEPTH; depth++) {
      const parentSession = await readParentSessionPath(current);
      if (!parentSession) return undefined;
      const parentFile = reasoningFileFor(parentSession);
      if (!parentFile) return undefined;
      try {
        const state = parseReasoningState(JSON.parse(await fs.readFile(parentFile, "utf8")));
        if (state.checkpoints.length > 0) {
          logInfo("reasoning", { event: "inherited-parent-state", file: parentFile, depth, checkpoints: state.checkpoints.length });
          return state;
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          logWarn("reasoning", { event: "parent-state-load-failed", file: parentFile, error: error instanceof Error ? error.message : String(error) });
          return undefined;
        }
      }
      current = parentSession;
    }
    logWarn("reasoning", { event: "parent-chain-exhausted", file: sessionFile, maxDepth: MAX_PARENT_CHAIN_DEPTH });
    return undefined;
  }
}

function findRecentDuplicate(checkpoints: readonly ReasoningCheckpoint[], input: ReasoningCheckpointInput): ReasoningCheckpoint | undefined {
  const start = Math.max(0, checkpoints.length - RECENT_DUPLICATE_SCAN);
  for (let i = checkpoints.length - 1; i >= start; i--) {
    const c = checkpoints[i];
    if (c && checkpointMatchesInput(c, input)) return c;
  }
  return undefined;
}

function checkpointMatchesInput(c: ReasoningCheckpoint, i: ReasoningCheckpointInput): boolean {
  return c.topic === i.topic
    && c.goal === i.goal
    && arraysEqual(c.hypotheses, i.hypotheses ?? [])
    && arraysEqual(c.evidence, i.evidence ?? [])
    && arraysEqual(c.eliminated, i.eliminated ?? [])
    && arraysEqual(c.decisions, i.decisions ?? [])
    && arraysEqual(c.openQuestions, i.openQuestions ?? [])
    && arraysEqual(c.nextSteps, i.nextSteps ?? [])
    && arraysEqual(c.tags, i.tags ?? []);
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function searchReasoning(checkpoints: readonly ReasoningCheckpoint[], query: string, limit = 10): ReasoningSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  const terms = queryTerms(normalizedQuery);
  const scored: ReasoningSearchResult[] = [];

  for (const checkpoint of checkpoints) {
    const fields: Array<[string, number]> = [
      [checkpoint.topic, 8], [checkpoint.goal, 5], [checkpoint.decisions.join(" "), 7],
      [checkpoint.evidence.join(" "), 5], [checkpoint.hypotheses.join(" "), 4],
      [checkpoint.eliminated.join(" "), 4], [checkpoint.openQuestions.join(" "), 4],
      [checkpoint.nextSteps.join(" "), 4], [checkpoint.tags.join(" "), 6],
    ];
    let score = 0;
    for (const [field, weight] of fields) {
      const text = normalizeSearchText(field);
      if (!text) continue;
      if (text.includes(normalizedQuery)) score += weight * 3;
      for (const term of terms) if (text.includes(term)) score += weight;
    }
    if (score > 0) scored.push({ checkpoint, score });
  }

  scored.sort((a, b) => b.score - a.score || b.checkpoint.createdAt - a.checkpoint.createdAt || b.checkpoint.id.localeCompare(a.checkpoint.id));
  return scored.slice(0, Math.max(1, Math.min(50, Math.floor(limit || 10))));
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function queryTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const part of query.split(/[^\p{L}\p{N}_./-]+/u)) if (part.length >= 2) terms.add(part);
  for (const match of query.match(/[a-z0-9_./-]+/g) ?? []) if (match.length >= 2) terms.add(match);
  for (const match of query.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]{2,}/gu) ?? []) terms.add(match);
  return [...terms];
}

function parseReasoningState(value: unknown): ReasoningState {
  if (!value || typeof value !== "object") return freshState();
  const record = value as Record<string, unknown>;
  const checkpoints = (Array.isArray(record.checkpoints) ? record.checkpoints : [])
    .map(parseReasoningCheckpoint)
    .filter((checkpoint): checkpoint is ReasoningCheckpoint => checkpoint !== undefined);
  const inferredNext = checkpoints.reduce((max, c) => Math.max(max, Number(c.id.slice(1)) + 1 || 1), 1);
  const storedNext = typeof record.nextCheckpointId === "number" && Number.isFinite(record.nextCheckpointId)
    ? Math.floor(record.nextCheckpointId) : 1;
  return { version: 1, nextCheckpointId: Math.max(1, storedNext, inferredNext), checkpoints };
}

function parseReasoningCheckpoint(value: unknown): ReasoningCheckpoint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const topic = typeof record.topic === "string" ? cleanText(record.topic) : "";
  const goal = typeof record.goal === "string" ? cleanText(record.goal) : "";
  if (!/^r\d+$/.test(id) || !topic || !goal) return undefined;
  return {
    id,
    createdAt: typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : 0,
    topic,
    goal,
    hypotheses: parseStringArray(record.hypotheses),
    evidence: parseStringArray(record.evidence),
    eliminated: parseStringArray(record.eliminated),
    decisions: parseStringArray(record.decisions),
    openQuestions: parseStringArray(record.openQuestions),
    nextSteps: parseStringArray(record.nextSteps),
    tags: parseStringArray(record.tags),
  };
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? cleanList(value.filter((item): item is string => typeof item === "string")) : [];
}
