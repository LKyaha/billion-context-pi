# Reasoning Memory Taskbook

> Repository-level compressed project memory for the Pi-only reasoning-aware ACP experiment.
>
> Preserve **goal → hypotheses → evidence → eliminated paths → decisions → open questions → next steps**. Do not mirror chat transcripts or hidden chain-of-thought.

## Working Protocol

Read **Current State** before resuming work. Update this file at major design decisions, root-cause discoveries, important validation results, upstream-sync events, or handoff boundaries. Periodically re-compress older checkpoints so this file does not become another unbounded context log.

---

# Current State

**Date:** 2026-09-08  
**Repository:** `LKyaha/billion-context-pi`  
**Branch:** `2026-09-08_reasoning-memory`  
**Draft PR:** `#1` — `feat: add Pi reasoning memory checkpoints`  
**Upstream base:** `ranxianglei/billion-context-pi@f2c59240f4ff7bc04f9e165060abfaca4649f4ac`

## Goal

Extend `billion-context-pi` with a Pi-only, provider-independent reasoning-memory layer that preserves durable investigation state across ACP compression without OpenAI encrypted reasoning state and without persisting hidden/raw chain-of-thought.

## Implemented V1

- `checkpoint_reasoning`
  - persists topic, goal, hypotheses, evidence, eliminated paths, decisions, open questions, next steps, and tags;
  - uses provider-friendly text fields rather than nested list arguments for better Qwen/vLLM non-strict tool compatibility;
  - serializes concurrent appends per session;
  - suppresses exact recent duplicate checkpoints and does not advance IDs for duplicates;
  - fails loudly on disk write errors.
- `search_reasoning`
  - separate from `search_context`;
  - weighted search across topic, goal, hypotheses, evidence, decisions, eliminations, unresolved questions, next steps, tags, file names, CJK text, and numeric values.
- Persistence
  - disk sessions: `<session>.reasoning.json` using temp-file + atomic rename;
  - file-less sessions: in-memory cache keyed by session ID;
  - Pi forks/clones inherit reasoning through bounded `parentSession` traversal and continue checkpoint IDs.
- Reasoning-aware compression guidance
  - checkpoint durable WHY before compressing root-cause/architecture/decision-rich history when useful;
  - do not checkpoint routine logs, transient output, or unchanged state.
- Compatibility
  - original named `createAcpExtension()` remains reasoning-free;
  - only package default entry adds the reasoning wrapper;
  - `enabled:false`, OMP refusal, `BILLION_CONTEXT_PROXY`, and manual `/bili/` wire-proxy base URLs are respected;
  - reasoning prompt/tools stand down when the wire proxy owns context management.
- Pollution/safety guards
  - retrieved checkpoints are historical model-generated metadata, never current user instructions;
  - current system/user intent overrides stored reasoning;
  - critical exact facts should be revalidated with current files/tools or `search_context`/`decompress`;
  - checkpoint text reuses ACP `summary-sanitize` for dense literal `\\uXXXX` corruption;
  - unverifiable “user said / 用户原话” claims are logged rather than trusted;
  - plaintext reasoning sidecars must not contain API keys, passwords, cookies, tokens, private keys, recovery codes, or other secret values.

## Architecture

```text
Pi default extension
├── existing ACP extension
│   ├── compress
│   ├── decompress
│   ├── search_context
│   └── acp_status
└── reasoning wrapper
    ├── checkpoint_reasoning
    ├── search_reasoning
    ├── reasoning prompt
    └── ReasoningStore
        ├── <session>.reasoning.json
        ├── in-memory session cache
        └── parentSession inheritance
```

`TASKBOOK.md` and runtime reasoning memory are intentionally different layers:

- **Runtime reasoning memory:** model-facing, session-oriented, searchable milestones.
- **Taskbook:** human/agent-facing, Git-versioned project handoff memory.

## Validation Status — PASS

Actions were enabled on the fork and a real PR synchronization commit triggered all workflows.

### Main CI — PASS

Workflow run `34179794960`:

- `pr-validation` — PASS
- Ubuntu / Node 22 — `npm ci` + `npm run typecheck` + `npm test` + `npm run build` — PASS
- Ubuntu / Node 24 — same matrix — PASS
- Windows / Node 22 — same matrix — PASS
- Windows / Node 24 — same matrix — PASS

### E2E — PASS

Workflow run `34179794956`:

- Docker E2E — PASS
- Ubuntu E2E — PASS
- Windows E2E — PASS

### PR Build Artifact — build PASS, publish unavailable on fork

Workflow run `34179795046`:

- `npm ci` — PASS
- `npm run build` — PASS
- npm PR-tag publish — FAIL with `ENEEDAUTH` because fork secret `NPM_TOKEN` is empty

This is an infrastructure/credential limitation of the fork, not a source/build failure. The workflow currently stops before tarball upload because publishing is placed before artifact creation.

## Upstream Status

At the latest check, upstream `master` still equals our original base SHA `f2c59240...`; no upstream drift or merge conflict exists yet.

## Upstream Sync Policy

```text
upstream/master
      ↓ sync
fork master
      ↓ inspect
reasoning feature branch
      ↓ merge/rebase deliberately
CI + E2E + practical Pi test
      ↓
update TASKBOOK
```

Syncing only fork `master` never modifies the reasoning branch. Never develop directly on fork `master`.

## Remaining Gate Before Calling V1 Field-Tested

1. Install the branch build into a real Pi instance.
2. Verify the default tool list exposes `checkpoint_reasoning` and `search_reasoning` exactly once.
3. Run a real checkpoint → search → restart/reopen → search cycle.
4. Fork a Pi session and confirm parent reasoning recovery plus ID continuation.
5. Trigger ACP compression after a decision-rich investigation and verify the model checkpoints durable WHY without checkpointing routine logs.
6. Test at least one local/non-strict provider, preferably Qwen via vLLM-style tool calling.
7. Inspect the generated `.reasoning.json` for readability, absence of secrets, and acceptable growth.

## Open Questions

- Should V1 add `reasoning_status`, or wait for real usage demand?
- Should old checkpoints later support superseding/topic compaction?
- Should resume ever auto-retrieve likely relevant reasoning, or remain explicit via `search_reasoning`?
- How well do smaller Qwen/DeepSeek/GLM models follow checkpoint-before-compress guidance in long sessions?
- Should the fork alter the PR artifact workflow so missing `NPM_TOKEN` skips publishing but still uploads an installable tarball?

---

# Compressed Decision History

## Checkpoint 0001 — Initial Design

**Hypothesis:** structured reasoning state is more useful and portable than raw model thinking.  
**Decision:** Pi-only, provider-independent V1; preserve explicit `hypothesis → evidence → elimination → decision → unresolved → next`, not hidden CoT or OpenAI encrypted state.

## Checkpoint 0002 — Project-Level Context Compression

**Problem:** chat/session memory itself can be summarized or lost.  
**Decision:** `TASKBOOK.md` is the repository-level handoff/context-compression layer; store durable conclusions rather than full dialogue.

## Checkpoint 0003 — Storage and Tool Architecture

**Evidence:** `CompressionState` belongs to `acp-kernel`; Pi exposes parent sessions; `search_context` has existing block/message semantics.  
**Decision:** independent `.reasoning.json` sidecar, append-only V1, separate `search_reasoning`, thin wrapper entrypoint, no kernel changes.

## Checkpoint 0004 — Integration Hardening

**Bug found:** wrapper `session_start -> store.invalidate()` erased file-less reasoning state.  
**Fix:** one long-lived `ReasoningStore` per extension instance; session isolation remains inside the store.  
**Also fixed:** reasoning prompt behavior was separated from the public named factory.

## Checkpoint 0005 — Compatibility and Pollution Resistance

**Verified from Pi core:** multiple `before_agent_start` system-prompt handlers are chained sequentially via `currentSystemPrompt`; the ACP prompt flows into the reasoning wrapper correctly.  
**Added:** manual `/bili/` stand-down, historical-metadata instruction guard, exact duplicate suppression, ACP sanitizer reuse, and secret-persistence warning.  
**Rejected:** automatic reasoning compaction before real-world growth data exists.

## Checkpoint 0006 — CI/E2E Validation Passed

**Date:** 2026-09-08

### Goal

Move the project from “statically reviewed” to “actually built and tested across the upstream matrix.”

### Evidence

- Fork Actions were enabled and PR synchronize triggered real workflows.
- All required Ubuntu/Windows Node 22/24 CI jobs passed typecheck, tests, and build.
- Docker/Ubuntu/Windows E2E all passed.
- PR artifact workflow built successfully; its only failure is npm authentication because the fork lacks upstream `NPM_TOKEN`.

### Eliminated

- “The feature may not typecheck on Windows/Node 24” — ruled out by CI.
- “The wrapper may break existing E2E regression scenarios” — ruled out by all E2E jobs passing.
- “PR artifact failure indicates a code/build problem” — ruled out by logs: build succeeded, then npm publish failed with empty `NODE_AUTH_TOKEN` / `ENEEDAUTH`.

### Decisions

1. Code-level V1 validation gate is passed.
2. Keep PR as Draft until practical Pi session testing is completed.
3. Do not add more reasoning features before real field testing unless a blocker is found.
4. Next work should focus on installability and real Pi behavior, especially local Qwen/non-strict tool calling.

### Next Steps

1. Make an installable fork artifact available without requiring npm publish credentials, or install from a local/git checkout.
2. Run the practical Pi validation sequence listed in Current State.
3. Record empirical checkpoint frequency, sidecar size, retrieval quality, and compression behavior.
4. Only then decide whether `reasoning_status`, auto-recall, or checkpoint compaction belongs in V1.1.
