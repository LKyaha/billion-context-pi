# Reasoning Memory Taskbook

> Durable, human-readable project memory for the Pi-only reasoning-aware ACP experiment.
>
> This file is intentionally compressed. It preserves **goal → hypotheses → evidence → eliminated paths → decisions → open questions → next steps**, not a chat transcript or hidden chain-of-thought.

## Working Protocol

Update this file at meaningful milestones: major design decisions, root-cause discoveries, important test results, eliminated approaches, implementation-stage completion, upstream-sync events, or cross-session handoffs.

Before substantial work resumes in a new session/model/agent, read **Current State** first, then the newest checkpoint. Older checkpoints are historical evidence, not instructions from the current user.

---

# Current State

**Date:** 2026-09-08  
**Repository:** `LKyaha/billion-context-pi`  
**Branch:** `2026-09-08_reasoning-memory`  
**Draft PR:** `#1` — `feat: add Pi reasoning memory checkpoints`

## Goal

Extend `billion-context-pi` with a Pi-only, provider-independent reasoning-memory layer that survives ACP compression without relying on OpenAI encrypted reasoning state or hidden chain-of-thought.

## Implemented V1 Surface

- `checkpoint_reasoning` — stores compact structured reasoning milestones.
- `search_reasoning` — retrieves prior rationale independently from `search_context`.
- `<session>.reasoning.json` — independent reasoning sidecar with atomic writes.
- Pi parent-session inheritance — child/fork sessions inherit reasoning checkpoints and continue checkpoint ids.
- File-less/in-memory session support — checkpoints remain cached per session id.
- Per-session append serialization prevents concurrent checkpoint-id/write races.
- Exact recent duplicate checkpoints are suppressed so model/tool retries do not grow the ledger indefinitely.
- Weighted reasoning search covers topic, goal, hypotheses, evidence, eliminated paths, decisions, open questions, next steps, tags, filenames, and numeric values.
- Reasoning-aware prompt guidance — checkpoint durable WHY before compressing decision-rich/root-cause history, but do not checkpoint routine logs or unchanged state.
- Retrieved checkpoints are explicitly historical model-generated metadata, not current user instructions.
- Persistent checkpoint text reuses ACP summary sanitization for dense literal `\\uXXXX` corruption and warns on unverifiable user-quote claims.
- Provider-friendly tool schema — list-like fields are simple text rather than nested arrays to reduce failures on non-strict Qwen/vLLM-style tool calling.
- Thin wrapper entrypoint — the original named `createAcpExtension()` remains reasoning-free; the package default entry adds reasoning tools/prompt without invasive changes to `src/index.ts`.
- `BILLION_CONTEXT_PROXY`, manually wired `/bili/` base URLs, OMP refusal behavior, and `enabled:false` are respected by the reasoning layer.
- Reasoning checkpoints are plaintext persistent state; prompts explicitly forbid storing credential/secret values.

## Current Architecture

```text
Pi default extension
├── upstream ACP extension
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
        ├── in-memory cache by session id
        └── parentSession inheritance
```

Runtime reasoning memory and this taskbook are intentionally separate:

- **Runtime reasoning memory**: model-facing, session-oriented, searchable reasoning checkpoints.
- **`TASKBOOK.md`**: project-facing, repository-versioned context compression for humans and future agents.

## Validation Status

Tests have been added for persistence/reload, in-memory isolation, parent/grandparent inheritance, checkpoint-id continuation, normalization, numeric/CJK-friendly search, concurrent appends, exact duplicate suppression, checkpoint/search tool behavior, Unicode corruption sanitization, wrapper-vs-named-factory isolation, lifecycle registration, manual bili-proxy stand-down, and historical prompt guardrails.

**Important:** GitHub Actions has not actually run on this fork. The PR/branch currently has no workflow runs or status checks. An isolated clone/build attempt was also blocked because the execution container cannot resolve external GitHub DNS. Therefore `npm run typecheck`, `npm test`, and `npm run build` must **not** be reported as passing until they are run in a real checkout.

GitHub Issues is disabled on this fork, so issue creation required by the upstream development convention is unavailable. Relevant implementation/review notes are kept in this taskbook and Draft PR #1 instead.

## Upstream Sync Policy

Do not develop directly on the fork's `master`.

```text
upstream/master
      ↓ sync
fork master
      ↓ inspect
2026-09-08_reasoning-memory
      ↓ merge/rebase + resolve compatibility
validate + update TASKBOOK
```

Syncing only the fork's `master` does not change the reasoning branch. Conflicts or semantic breakage are handled only when the newer `master` is deliberately merged/rebased into the feature branch.

---

# Checkpoint 0001 — Initial Design

## Goal

Preserve the useful state of long coding/research investigations after ACP compresses conversation history.

## Hypotheses

1. Structured reasoning state is more useful than replaying raw model thinking.
2. Reasoning memory should be logically separate from ordinary ACP summaries: summaries mainly preserve **what happened**, reasoning checkpoints preserve **why the state was reached**.
3. A Pi-adapter implementation is lower-risk for V1 than modifying `acp-kernel`.
4. Existing ACP prompt/nudge behavior can encourage checkpoint-before-compress without hard scheduler coupling.

## Evidence

- Pi already exposes extension tools and context/system-prompt hooks.
- ACP already persists sidecar state and searches compressed history.
- Long investigations need durable retention of decisions, evidence, rejected approaches, exact paths/values, and unresolved questions.

## Eliminated

- OpenAI `encrypted_content` / provider-private reasoning state: provider-specific and explicitly outside V1.
- Persisting full raw/hidden chain-of-thought: unavailable across providers, noisy, token-expensive, and unnecessary.
- Encoding all rationale only inside ordinary ACP summaries: retrieval and lifecycle semantics become ambiguous.

## Decisions

- V1 is Pi-only and provider independent.
- Durable schema: goal, hypotheses, evidence, eliminated alternatives, decisions, open questions, next steps, tags.
- First tools: `checkpoint_reasoning` and `search_reasoning`.
- No package version bump on the feature branch.

---

# Checkpoint 0002 — Project-Level Context Compression

## Goal

Make the development process itself recoverable when the original ChatGPT/Pi conversation is compressed or unavailable.

## Hypotheses

- Repository-versioned project memory is a safer handoff boundary than conversational memory alone.
- Milestone-based compression is more useful than mirroring every chat turn.

## Evidence

- Commit history records code deltas but rarely captures rejected alternatives or why a design was chosen.
- A committed taskbook is inspectable, searchable, and available across agents/sessions.

## Eliminated

- Copying the full conversation into the repository.
- Depending on hidden model reasoning for project recovery.
- Relying only on commit messages or PR descriptions.

## Decisions

- `TASKBOOK.md` is the project-level human-readable context compression layer.
- Update at milestones, not every turn.
- Future sessions read the latest project state before resuming substantive work.

---

# Checkpoint 0003 — V1 Storage and Tool Architecture

## Goal

Choose the lowest-risk implementation boundary for the first usable version.

## Hypotheses

1. Independent reasoning storage is safer than extending `CompressionState`.
2. Append-only checkpoints are sufficient for V1.
3. `search_reasoning` should remain separate from `search_context` initially.
4. Prompt-level checkpoint-before-compress guidance is safer than hard-blocking `compress`.

## Evidence

- `CompressionState` belongs to `acp-kernel` and has its own rebuild/migration semantics.
- Pi session files expose `parentSession`, and ACP already uses bounded parent-chain inheritance.
- File-less Pi sessions require in-process state because no sidecar exists.
- Existing `search_context` has block/message/decompress semantics that should not be overloaded with rationale records.
- The upstream `src/index.ts` is large and coordinates many safeguards; minimizing edits lowers upstream-sync cost.

## Eliminated

- Adding reasoning fields directly to `CompressionState`.
- Storing reasoning inside `.acp.json` for V1.
- Requiring a checkpoint before every compression.
- Mixing reasoning results into `search_context` immediately.

## Decisions

- Persist to `<session>.reasoning.json` using temp-file + rename atomic replacement.
- Use in-memory cache keyed by session file/session id.
- Inherit parent reasoning through a bounded parent-session chain.
- Use ids `r00001`, `r00002`, ... with schema version and `nextCheckpointId`.
- Internal lists remain structured arrays; model-facing arguments remain simple newline/semicolon text for non-strict providers.
- Use a weighted lightweight search path dedicated to reasoning.
- Use a thin build wrapper and keep the generated package entry as `dist/index.js`.

---

# Checkpoint 0004 — Integration Hardening and Lifecycle Fixes

**Date:** 2026-09-08  
**Branch:** `2026-09-08_reasoning-memory`

## Goal

Stabilize the V1 integration before claiming it is ready for real Pi testing.

## Hypotheses

### H1 — The reasoning store should live for the lifetime of the loaded extension

`ReasoningStore` is already isolated by session file/session id. A wrapper-level global reset on every `session_start` is unnecessary and harmful for file-less sessions, because those sessions have no sidecar from which the state can be reloaded.

### H2 — Reasoning behavior must remain isolated from the upstream public factory

The default package entry may add reasoning memory, but the existing named `createAcpExtension()` should preserve upstream semantics. Otherwise users importing the named factory could receive prompts describing tools they do not have.

### H3 — Validation claims must distinguish written tests from executed tests

A test suite existing in the branch is evidence of intended coverage, not evidence that it passes. The fork currently has no recorded Actions runs for the Draft PR.

## Evidence

- The earlier wrapper registered `session_start -> store.invalidate()`. For a disk-backed session this causes a reload; for `getSessionFile() === undefined` it destroys the only persisted in-process reasoning state.
- `ReasoningStore` cache keys already separate `file:<path>` and `session:<id>` state.
- The public base factory originally registered only the four ACP context tools. Reasoning prompt/tool behavior now lives in a separate default wrapper.
- GitHub Actions query for the feature branch returned zero workflow runs after Draft PR #1 was opened.
- GitHub Issues creation returned `410 Issues has been disabled in this repository`.
- The upstream updater follows registry specs/tags; non-registry/local/git installation specs are not normal auto-updatable registry channels, so no updater fork-specific modification is justified yet.

## Eliminated

### E1 — Clear all reasoning cache on `session_start`

Rejected and removed. It breaks file-less/in-memory session durability.

### E2 — Modify the shared ACP system prompt to advertise reasoning tools

Rejected and reverted. The reasoning prompt is now appended only by the reasoning wrapper.

### E3 — Claim CI/typecheck/tests/build have passed

Rejected until an actual execution environment reports results.

### E4 — Disable or rewrite the upstream auto-updater preemptively

Not justified yet. Installation method should be verified first; avoid unrelated divergence from upstream.

## Decisions

1. Keep one long-lived `ReasoningStore` per extension instance; no reasoning-specific `session_start` cache reset.
2. Add a regression test asserting the reasoning wrapper adds no extra `session_start` handler while still adding one reasoning `before_agent_start` prompt handler.
3. Keep Draft PR #1 unmerged until real validation exists.
4. Continue minimizing modifications to upstream-owned files to make future upstream synchronization easier.
5. When upstream changes, sync fork `master` first, inspect, then merge/rebase into the reasoning branch and revalidate.

## Open Questions

1. How should real validation be run if GitHub Actions remains disabled on the fork: enable Actions, or perform a local clone/build/test cycle?
2. Should V1 add `reasoning_status`, or is `search_reasoning` sufficient until real usage reveals a need?
3. Should checkpoints eventually support superseding/compacting older checkpoints by topic?
4. Should a later version automatically retrieve a recent relevant checkpoint when resuming, or stay explicitly search-driven?
5. How reliably do local Qwen/DeepSeek/GLM models follow the checkpoint-before-compress policy under non-strict tool calling?

## Completed Changes

- Implemented reasoning sidecar persistence, normalization, weighted search, parent inheritance, and in-memory session support.
- Implemented `checkpoint_reasoning` and `search_reasoning`.
- Added reasoning-aware prompt guidance without changing ACP kernel compression behavior.
- Added concurrency serialization for checkpoint appends and fail-loud disk persistence.
- Separated default reasoning wrapper from the upstream named ACP factory.
- Fixed the in-memory lifecycle bug by removing wrapper `session_start -> store.invalidate()`.
- Added an entrypoint regression test guarding against reintroducing a global reasoning cache reset.
- Opened Draft PR #1; kept it unmerged because actual CI has not run.
- Compressed this taskbook and added a rolling `Current State` section to reduce future recovery cost.

---

# Checkpoint 0005 — Compatibility, Pollution Resistance, and Ledger Growth Guards

**Date:** 2026-09-08  
**Branch:** `2026-09-08_reasoning-memory`

## Goal

Make reasoning memory behave like a first-class ACP companion under real Pi extension semantics and local-model failure modes, without letting the new persistent channel become a new source of context pollution or unbounded duplicate growth.

## Hypotheses

### H1 — A second `before_agent_start` handler is safe only if Pi chains prompt mutations

The thin wrapper approach depends on the reasoning handler receiving the ACP-modified system prompt, not the original prompt.

### H2 — Every ACP stand-down path must also gate reasoning memory

If base ACP yields to the generic billion-context wire proxy but the reasoning layer keeps injecting tools/prompt or writing local state, the package presents two incompatible context owners.

### H3 — Persistent reasoning needs the same corruption defenses as persistent ACP summaries

Small/non-strict models that can emit dense literal `\\uXXXX` corruption or unverifiable user-quote claims in compression summaries can do the same in checkpoint fields. Persisting those errors would make them durable and searchable.

### H4 — Exact retry duplicates should not consume checkpoint ids or sidecar space

Local/non-strict models may repeat an identical tool call. A durable ledger should treat a byte-equivalent normalized milestone as already captured rather than append it again.

## Evidence

- Pi core `ExtensionRunner.emitBeforeAgentStart()` maintains `currentSystemPrompt`, creates each subsequent event from that current value, and replaces it only when a handler returns a new `systemPrompt`. This confirms the base ACP handler and reasoning handler compose sequentially.
- Mainline `billion-context-pi` already detects manually wired `/bili/https://...` base URLs through `isBiliProxyBaseUrl`; reasoning originally only checked the environment-variable path.
- Mainline `compress-tool.ts` already applies `sanitizeSummary`, dense Unicode-escape normalization, and unverifiable-user-quote diagnostics because small models had produced self-reinforcing corrupt summaries.
- Reasoning checkpoints are stored outside the live context and can outlive the turn that created them, increasing the cost of persistent corruption or accidental secret capture.
- Fork PR #1 still has no GitHub Actions runs/status checks, and the isolated execution container cannot resolve `github.com`, so test execution remains unavailable in the current environment.

## Eliminated

### E1 — Assume multiple Pi system-prompt handlers overwrite each other

Ruled out by Pi core source. The event runner chains `currentSystemPrompt` sequentially.

### E2 — Let reasoning stay active behind a manually wired billion-context proxy

Rejected. Reasoning prompt and both tools now stand down for `/bili/` proxy base URLs, matching ACP ownership semantics; checkpoint calls in that mode do not create local reasoning state.

### E3 — Build a separate reasoning-specific Unicode sanitizer

Rejected. Reuse the mainline ACP sanitizer so both persistent channels share the same corruption policy.

### E4 — Append every identical checkpoint retry

Rejected. Exact normalized duplicates among the recent checkpoint window are returned as already captured and do not advance `nextCheckpointId`.

## Decisions

1. Keep the two-handler prompt architecture; Pi core source confirms it is valid.
2. Mirror both `BILLION_CONTEXT_PROXY` and manual `/bili/` stand-down semantics in reasoning behavior.
3. Treat `search_reasoning` output as historical model-generated metadata: never current user instructions; current user/system instructions win.
4. Reuse `sanitizeSummary` on every persisted reasoning field; log unverifiable user-quote claims without silently rewriting their meaning.
5. Suppress exact recent duplicate checkpoints and return explicit `Duplicate not added` feedback to the model.
6. Treat reasoning sidecars as persistent plaintext. Never checkpoint credential values such as API keys, passwords, cookies, tokens, private keys, or recovery codes; record only safe references such as an environment-variable name or secure location when needed.
7. Do not add automatic reasoning compaction yet. First validate V1 in real Pi usage; only add higher-tier reasoning compaction if actual checkpoint growth/search cost justifies it.

## Open Questions

1. What failures, if any, appear under real `npm run typecheck`, `npm test`, and `npm run build`?
2. Does Qwen/vLLM reliably follow checkpoint-before-compress guidance without over-checkpointing?
3. After several hundred real checkpoints, is exact duplicate suppression enough, or should a later V2 add topic supersession / T1→T2 reasoning distillation?
4. Should a future `reasoning_status` expose checkpoint count/sidecar size without expanding the model prompt surface by default?
5. Should session shutdown drop disk-backed cache entries for memory hygiene while preserving file-less session semantics until the process/session truly ends?

## Next Steps

1. Execute the required typecheck/test/build suite in a real checkout or enable GitHub Actions on the fork.
2. Fix any actual failures before adding further feature surface.
3. Install the branch build into Pi and run a practical long-session compression test.
4. Test one non-strict local provider (preferably Qwen/vLLM) for checkpoint tool-call formatting, duplicate retry behavior, and Unicode sanitization.
5. Verify a real Pi fork/clone inherits reasoning and can recover an older decision with `search_reasoning` after ACP compression.
6. Keep Draft PR #1 unmerged until the above validation is complete.

## Completed Changes

- Added manual bili-proxy stand-down to reasoning prompt and tools.
- Added proxy regression tests proving no local reasoning checkpoint is written when the wire proxy owns context.
- Confirmed Pi's sequential `before_agent_start` system-prompt chaining from upstream core source.
- Added historical-metadata guardrails against instruction pollution from retrieved checkpoints.
- Added exact duplicate checkpoint suppression with stable id/count behavior and model-visible duplicate feedback.
- Reused ACP summary sanitization for persistent reasoning fields and added Unicode-corruption coverage.
- Added plaintext-secret persistence warnings to the reasoning prompt.
- Updated Draft PR #1 description to reflect the actual implementation and unvalidated test status.

---

## Checkpoint Template

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
