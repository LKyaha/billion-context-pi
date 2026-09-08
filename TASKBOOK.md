# Reasoning Memory Taskbook

> Durable project memory for the Pi-only reasoning-aware ACP experiment.
>
> This file is intentionally maintained alongside code so a future session, model, or agent can recover not only **what changed**, but **why the work moved in that direction**.

## Working Protocol

At every meaningful milestone, update this file before moving on. Prefer compact, evidence-backed state over chronological narration.

Each checkpoint should preserve:

1. **Goal** — what we are trying to achieve.
2. **Hypotheses** — current explanations or design candidates.
3. **Evidence** — observations, code facts, tests, benchmarks, or upstream behavior supporting/refuting hypotheses.
4. **Eliminated** — options or explanations ruled out, with reasons.
5. **Decisions** — choices already made and their rationale.
6. **Open Questions** — unknowns that still matter.
7. **Next Steps** — the smallest concrete actions that advance the work.
8. **Completed Changes** — durable record of code/docs/tests already changed.

Do not store hidden chain-of-thought. Store concise, inspectable reasoning state: hypotheses, evidence, rejected alternatives, decisions, unresolved questions, and next actions.

---

## Project Goal

Extend `billion-context-pi` with a Pi-only, provider-independent reasoning-memory layer that survives long-context compression without relying on OpenAI encrypted reasoning state.

Desired user-visible capabilities:

- `checkpoint_reasoning` — persist a structured reasoning checkpoint at meaningful milestones.
- `search_reasoning` — retrieve relevant past reasoning state without restoring the full conversation.
- reasoning-aware compression — encourage/ensure durable reasoning state is checkpointed before context that contains important investigation or decisions is compressed.
- future-compatible recovery — allow a later Pi session/agent to resume from explicit reasoning state rather than only a prose conversation summary.

## Constraints

- Pi-only implementation for the first version.
- Provider independent: Qwen, DeepSeek, GLM, Claude, Gemini, OpenAI, etc. should work as long as Pi tool calling works.
- No dependency on OpenAI `encrypted_content` or provider-private hidden reasoning.
- Do not attempt to capture or preserve hidden chain-of-thought.
- Preserve upstream ACP behavior unless a deliberate, tested change is required.
- Follow repository `AGENTS.md` rules: strict TypeScript, no `as any`, no `@ts-ignore`, tests for new source features, no version bump on feature branches, no PR merge by agents.

---

# Checkpoint 0001 — Initial Design State

**Date:** 2026-09-08  
**Branch:** `2026-09-08_reasoning-memory`

## Goal

Design and implement the smallest useful reasoning-memory extension on top of the existing ACP adapter without destabilizing the current compression/decompression/search pipeline.

## Hypotheses

### H1 — Structured reasoning state is more useful than retaining raw model thinking

A compact schema containing:

- goal
- hypotheses
- evidence
- eliminated alternatives
- decisions
- open questions
- next action

should preserve the parts of an investigation that matter for future continuation while avoiding the token growth and instability of replaying raw reasoning traces.

### H2 — Reasoning memory should be a separate logical layer from ordinary ACP summaries

Ordinary ACP summaries answer primarily **what happened**. A reasoning ledger should answer **why the current state was reached**. Keeping this distinct should improve searchability, update semantics, and future compression policy.

### H3 — Pi adapter is the right place for v1 persistence and tools

Because v1 is intentionally Pi-only, adding persistence/tooling in `billion-context-pi` is likely lower-risk than modifying the platform-agnostic `acp-kernel` immediately. Kernel changes should only be introduced if adapter-only implementation proves insufficient for reasoning-aware compression.

### H4 — Existing ACP nudge/compression hooks can probably trigger checkpointing without invasive scheduler changes

The project already injects compression guidance/nudges. A reasoning-aware pre-compression instruction may be enough to make the model call `checkpoint_reasoning` before high-value context disappears.

## Evidence

- Repository architecture identifies `src/index.ts` as tool/hook registration, `src/state.ts` as session persistence, `src/runtime.ts` as state ownership, and `src/system-prompt.ts` as compression guidance.
- Existing tools already establish the host pattern: `compress-tool.ts`, `decompress-tool.ts`, `search-tool.ts`, `status-tool.ts`.
- Existing search infrastructure (`search-index.ts` + `search_context`) suggests reasoning search can reuse or mirror established indexing patterns.
- `AGENTS.md` explicitly says the adapter persists ACP state under Pi session storage and that new source features require tests.

## Eliminated

### E1 — Store OpenAI encrypted reasoning blobs

Rejected for v1 because the user explicitly wants a Pi-only implementation that does not depend on OpenAI encrypted model state. It would also make the feature provider-specific.

### E2 — Persist full raw reasoning / chain-of-thought every turn

Rejected. It would recreate context explosion, is unavailable for many providers, can be unstable/noisy, and hidden chain-of-thought must not be relied upon. We only preserve explicit reasoning state.

### E3 — Put all reasoning content into ordinary ACP summary text only

Rejected as the primary design. It is useful as a fallback, but a separate ledger gives cleaner retrieval and allows reasoning-specific lifecycle/policies later.

## Decisions

1. Create a dedicated feature branch before source changes.
2. Maintain this `TASKBOOK.md` as the durable external project memory and update it at milestones.
3. Implement v1 in the Pi adapter first.
4. Start with two core tools: `checkpoint_reasoning` and `search_reasoning`.
5. Use a structured, inspectable reasoning schema rather than free-form chain-of-thought.
6. Add reasoning-aware compression only after understanding the existing nudge/prompt flow and testing the two core tools.
7. Do not modify package version on this branch.

## Open Questions

1. What is the exact current shape of ACP session state in `src/state.ts`, and should reasoning checkpoints be embedded in the same `.acp.json` or stored separately?
2. Does Pi expose a stable session/message identifier suitable for anchoring checkpoints to conversation ranges?
3. Can existing `search-index.ts` safely index reasoning checkpoints, or should `search_reasoning` have a dedicated lightweight matcher?
4. Should checkpoint updates be append-only, superseding previous entries, or mutable by logical topic?
5. What schema produces reliable tool calls across smaller local models such as Qwen/DeepSeek variants?
6. How should reasoning checkpoints interact with forked Pi sessions and ACP state rebuilding?
7. Where exactly should the pre-compression checkpoint reminder be injected so it does not cause loops or excessive tool calls?

## Next Steps

1. Inspect `src/state.ts`, `src/runtime.ts`, `src/index.ts`, tool implementations, `src/system-prompt.ts`, and compression/nudge integration.
2. Inspect relevant tests to understand persistence and fork/session behavior.
3. Finalize the minimal checkpoint schema and persistence model.
4. Implement `checkpoint_reasoning` with tests.
5. Implement `search_reasoning` with tests.
6. Add prompt/nudge integration for reasoning-aware compression with regression tests.
7. Run `npm run typecheck`, `npm test`, and `npm run build` before proposing a PR.

## Completed Changes

- Fork confirmed at `LKyaha/billion-context-pi`.
- Repository development specification reviewed.
- Long-lived reasoning/work-state format agreed conceptually.
- Dedicated branch `2026-09-08_reasoning-memory` created from `master`.
- `TASKBOOK.md` introduced as the durable project reasoning ledger.

---

## Checkpoint Template

Copy this section for future milestones.

```md
# Checkpoint NNNN — Short Title

**Date:** YYYY-MM-DD

## Goal

## Hypotheses

## Evidence

## Eliminated

## Decisions

## Open Questions

## Next Steps

## Completed Changes
```
