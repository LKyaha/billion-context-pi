# Reasoning Ledger Taskbook

> Project-level compressed context for the Pi reasoning-ledger fork. Preserve durable decisions, evidence, eliminated paths, open questions, and next steps — not chat transcripts or hidden chain-of-thought.

## Current State

**Date:** 2026-09-13  
**Repository:** `LKyaha/billion-context-pi`  
**Branch:** `2026-09-13_thin-reasoning-ledger`  
**Upstream baseline:** `ranxianglei/billion-context-pi@dd183bda74ebc93cd0637618445c729024b91718`

### Goal

Keep upstream ACP as the primary long-context memory system and add only the missing sparse reasoning ledger:

- `checkpoint_reasoning` — persist durable WHY outside normal ACP summaries.
- `search_reasoning` — retrieve that WHY after summaries are heavily distilled.
- `<session>.reasoning.json` — small per-session sidecar, inherited across Pi parent sessions.

### Why the old fork was reset

Upstream moved significantly after the original 2026-09-08 fork and now already provides:

- reasoning-aware ACP summaries that explicitly keep decisions + rationale, experiment purpose, failed approaches, unresolved work, and goal evolution;
- `compress.reasoning` / `reasoning-drop`, which removes oversized historical thinking from the outgoing request view while preserving persisted history;
- prompt packs and substantial host/runtime hardening.

Therefore duplicating those behaviors in the fork would increase merge cost without adding unique capability.

### Thin architecture

```text
latest upstream ACP
├── compress / decompress / search_context / acp_status
├── rationale-aware T1/T2/T3 summaries
├── reasoning-drop
├── prompt packs
└── all upstream host/proxy/runtime safeguards

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
2. **Ledger is sparse.** Checkpoint only root causes, architecture choices, ruled-out approaches, experiment conclusions, or rationale likely to be lost by later T2/T3 distillation.
3. **No raw/private chain-of-thought.** Store only inspectable task-relevant reasoning state.
4. **No secrets.** API keys, tokens, passwords, cookies, private keys, and recovery codes must not enter persistent reasoning sidecars.
5. **Old sidecar schema stays compatible.** The new thin branch keeps version-1 `r00001...` checkpoints so prior test data can still be read.
6. **Minimize upstream edits.** Upstream `src/index.ts` is untouched; only the build entry changes to a thin wrapper.
7. **Reuse upstream safety helpers.** Unsupported-host and `/bili/` proxy detection come from current upstream modules instead of custom copies.

### Implemented on this branch

- `src/reasoning-memory.ts`
- `src/reasoning-tools.ts`
- `src/reasoning-prompt.ts`
- `src/reasoning-entry.ts`
- `tsup.config.ts`: entry switched from `src/index.ts` to `src/reasoning-entry.ts`

### Validation status

Not yet claimed passing for this new upstream baseline. The previous fork passed its CI/E2E matrix, but this branch must be revalidated because upstream changed substantially.

## Checkpoint 0001 — Rebase by reconstruction

### Hypothesis

Reconstructing the feature from the latest upstream commit is safer than rebasing the old 35+ commit feature branch because it avoids carrying obsolete compatibility code and duplicated functionality.

### Evidence

- Upstream current master already contains reasoning-drop and rationale-aware compression instructions.
- Current upstream tool registration remains centered on the original ACP tools; no `checkpoint_reasoning` or `search_reasoning` exists.
- Tier-3 compression intentionally becomes a compact lookup index and can drop detailed rationale, leaving a clear role for a separate sparse ledger.

### Eliminated

- Continue stacking changes on the 2026-09-08 fork.
- Reimplement upstream reasoning-drop.
- Add a second full context-management state machine.
- Persist full model thinking.

### Next steps

1. Add focused tests for store persistence/inheritance/search/dedup.
2. Add entrypoint tests for tool registration and stand-down behavior.
3. Run upstream CI/E2E on the new branch.
4. Fix only failures caused by the thin layer.
5. After green CI, run real Pi persistence/fork tests with a local/non-strict provider.
