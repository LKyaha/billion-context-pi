# Reasoning Ledger Taskbook

> Project-level compressed context for the Pi reasoning-ledger fork. Preserve durable decisions, evidence, eliminated paths, open questions, and next steps — not chat transcripts or hidden chain-of-thought.

## Current State

**Date:** 2026-09-13  
**Repository:** `LKyaha/billion-context-pi`  
**Branch:** `2026-09-13_thin-reasoning-ledger`  
**Draft PR:** `#2`  
**Upstream baseline:** `ranxianglei/billion-context-pi@dd183bda74ebc93cd0637618445c729024b91718`

### Goal

Keep upstream ACP as the primary long-context memory system and add only the missing sparse reasoning ledger:

- `checkpoint_reasoning` — persist durable WHY outside normal ACP summaries.
- `search_reasoning` — retrieve that WHY after summaries are heavily distilled.
- `<session>.reasoning.json` — small per-session sidecar, inherited across Pi parent sessions.

### Why the old fork was reset

Upstream moved significantly after the original 2026-09-08 fork and now already provides rationale-aware ACP summaries, `compress.reasoning` / reasoning-drop, prompt packs, and substantial host/runtime hardening. Carrying the old fork forward would duplicate upstream behavior and increase merge cost.

### Thin architecture

```text
latest upstream ACP
├── compress / decompress / search_context / acp_status
├── rationale-aware T1/T2/T3 summaries
├── reasoning-drop
├── prompt packs
└── upstream host/proxy/runtime safeguards

thin wrapper
├── checkpoint_reasoning
├── search_reasoning
├── ReasoningStore
│   ├── <session>.reasoning.json
│   ├── file-less in-process cache
│   ├── parentSession inheritance
│   └── recent exact-duplicate suppression
└── short REASONING LEDGER prompt
```

### Design decisions

1. **ACP summaries remain primary memory.** Do not checkpoint every compression or every turn.
2. **Ledger is sparse.** Checkpoint root causes, architecture choices, ruled-out approaches, experiment conclusions, or rationale likely to be lost by later T2/T3 distillation.
3. **No raw/private chain-of-thought.** Store only inspectable task-relevant reasoning state.
4. **No secrets.** API keys, tokens, passwords, cookies, private keys, and recovery codes must not enter persistent reasoning sidecars.
5. **Old sidecar schema stays compatible.** Version-1 `r00001...` checkpoints remain readable.
6. **Minimize upstream edits.** Upstream `src/index.ts` is untouched; only the build entry points to a thin wrapper.
7. **Reuse upstream safeguards.** Unsupported-host and `/bili/` proxy helpers come from current upstream modules.

### Current diff surface

- `src/reasoning-memory.ts`
- `src/reasoning-tools.ts`
- `src/reasoning-prompt.ts`
- `src/reasoning-entry.ts`
- `tests/reasoning-ledger.test.ts`
- `TASKBOOK.md`
- `tsup.config.ts` — one functional change: named `index` output now builds from `src/reasoning-entry.ts`

### Validation — PASS

Source commit `cc040473fc757219b73ed06246e402be8f8d9f82` passed current-upstream validation:

- `pr-validation` — PASS
- Ubuntu / Node 22 — `npm ci`, typecheck, build, full tests — PASS
- Ubuntu / Node 24 — PASS
- Windows / Node 22 — PASS
- Windows / Node 24 — PASS
- Docker E2E — PASS
- Ubuntu E2E — PASS
- Windows E2E — PASS

The PR Build Artifact workflow builds successfully but cannot publish the PR-tag npm package because this fork does not have the upstream `NPM_TOKEN`; this is credential/infrastructure-only.

## Checkpoint 0001 — Rebase by reconstruction

### Hypothesis

Reconstructing the feature from latest upstream is safer than rebasing the old 35+ commit feature branch.

### Evidence

- Upstream already contains reasoning-drop and strong rationale-aware compression instructions.
- Upstream still has no `checkpoint_reasoning` or `search_reasoning` tools.
- Tier-3 intentionally becomes a compact lookup index and may drop detailed rationale, leaving a clear role for a sparse external ledger.

### Eliminated

- Continue stacking changes on the 2026-09-08 fork.
- Reimplement upstream reasoning-drop.
- Add a second full context-management state machine.
- Persist full model thinking.

## Checkpoint 0002 — Latest-upstream CI/E2E validated

### Evidence

- First E2E run caught one packaging regression: using `entry: ["src/reasoning-entry.ts"]` made tsup emit `dist/reasoning-entry.js`, while the package and E2E contract require `dist/index.js`.
- Fix: use `entry: { index: "src/reasoning-entry.ts" }`. No reasoning logic changed.
- After the fix, the complete CI matrix and all three E2E environments passed.

### Decision

The thin-ledger source is now technically compatible with the current upstream baseline. Keep PR #2 Draft until real Pi field tests validate session restart, Pi fork inheritance, and behavior with at least one non-strict local provider.

### Next steps

1. Install/build this branch in real Pi.
2. Create a checkpoint, restart/resume the session, and verify `search_reasoning` recovery.
3. Fork a Pi session and verify inherited checkpoint + continued `rNNNNN` ids.
4. Run a decision-rich compression scenario and confirm ACP remains the primary memory while the ledger preserves WHY beyond heavy distillation.
5. Test at least one Qwen/vLLM-style non-strict tool-calling provider.
