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

This file is also the **project-level context compression layer**. It should capture durable state from design discussions, implementation work, tests, and cross-session handoffs without trying to mirror the full chat transcript. Before resuming substantial work in a new session or with a different model/agent, read the latest checkpoints first.

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

# Checkpoint 0002 — Project-Level Context Compression Policy

**Date:** 2026-09-08  
**Branch:** `2026-09-08_reasoning-memory`

## Goal

Make the taskbook itself a reliable recovery point for this project so future ChatGPT/Pi sessions, models, or agents can reconstruct the current work state even when the original conversation has been compressed or is unavailable.

## Hypotheses

### H1 — The project needs two different memory scopes

A runtime Pi reasoning ledger and a repository taskbook solve different problems:

- **Pi runtime reasoning memory** preserves reasoning state inside and across Pi sessions while ACP manages active context.
- **`TASKBOOK.md` project memory** preserves durable project decisions, evidence, rejected paths, and handoff state across chat systems, models, agents, and development sessions.

Keeping both layers is more robust than asking either one to serve both purposes.

### H2 — Milestone-based compression is better than copying the chat transcript

The durable value of this conversation is concentrated in decisions, evidence, rejected alternatives, unresolved questions, and next actions. Recording every turn would create a second context-growth problem and make recovery noisier.

### H3 — A repository checkpoint is a safer handoff boundary than relying on conversational memory

A committed file is versioned, inspectable, searchable, and available to future agents that can access the repository. Conversation state can be summarized, truncated, or unavailable in a different session.

## Evidence

- `TASKBOOK.md` already captures the initial architecture hypothesis, constraints, eliminated designs, decisions, open questions, and implementation plan from the current conversation.
- Git commits alone record code deltas but usually do not preserve rejected alternatives or why a design was selected.
- The project explicitly aims to survive long-context compression; its own development workflow should therefore use the same principle and preserve compact reasoning state outside the live conversation.

## Eliminated

### E1 — Mirror the full ChatGPT/Pi conversation into the repository

Rejected because it would be verbose, duplicate transient discussion, increase repository noise, and defeat the purpose of compression.

### E2 — Depend on hidden model chain-of-thought for project recovery

Rejected. Hidden reasoning is neither required nor appropriate for durable project state. The taskbook stores only inspectable reasoning artifacts: hypotheses, evidence, eliminations, decisions, open questions, and next steps.

### E3 — Rely only on commit messages, PR descriptions, or issues as project memory

Rejected as the sole mechanism. Those artifacts are useful evidence but are fragmented and optimized for code review/issue tracking rather than restoring the whole active research state.

## Decisions

1. `TASKBOOK.md` is formally the **project-level human-readable context compression layer**.
2. Update it at meaningful milestones rather than every conversational turn.
3. A milestone includes at least: major design decisions, new evidence that changes a hypothesis, ruled-out approaches, root-cause discoveries, implementation-stage completion, significant test results, and cross-session/handoff boundaries.
4. Before substantial work resumes in a new session/model/agent, read the latest taskbook checkpoints first.
5. Pi reasoning checkpoints and the taskbook remain separate layers with different lifetimes and audiences; v1 does not automatically write runtime checkpoints into the repository.
6. The current conversation should be represented in the taskbook by its durable conclusions, not by a verbatim transcript.

## Open Questions

1. After the Pi runtime reasoning-memory feature works, should there be an optional explicit export command that converts selected runtime checkpoints into a project-level Markdown handoff?
2. Should the taskbook eventually maintain a short rolling “Current State” section at the top for faster cold-start recovery once checkpoint count grows large?
3. Should taskbook maintenance stay agent-driven, or later gain a lightweight repository hook/command to reduce missed checkpoints?

## Next Steps

1. Resume source inspection from Checkpoint 0001.
2. Resolve persistence and schema questions before writing feature code.
3. Update this taskbook again once the storage/tool architecture is determined, before implementing the first source change.

## Completed Changes

- Formalized a two-layer memory model: Pi runtime reasoning memory + repository project memory.
- Added an explicit project-context-compression rule to the taskbook working protocol.
- Distilled the current design conversation into durable state without storing a full transcript or hidden reasoning.

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
