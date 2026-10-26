# Implementation plan: goal-aware context using the existing design brief

Status: the production-baseline adapter and offline corpus/budget protocol are implemented. A draft oracle evidence-aware selector is implemented; five priority judgments are human-confirmed, while the remaining records are not individually certified. Real-session collection, the planned frozen-corpus extraction/model/downstream experiments and production integration remain proposed work. Separate live-model pilots are reported below.
Code inspection baseline: `4cf33932edc5f687e3cf7190261ebbb02c898d08`.
The branch now contains offline controls, two live-model pilots and a research host-state API. These are controlled synthetic experiments, not production integration or held-out evidence.
Before a production change, refresh against main and re-check these entry points.

## Research progress and next integration boundary (2026-10-27)

[Host facts v2](./HOST_RESULTS.md) completed 70 model calls. The hybrid preserved authoritative file/verification facts while the model summarized user goals/preferences. Canonical-ID output removed the earlier free-form naming ambiguity; two Qwen over-budget summaries are still counted as failures. These scores do not compare directly with the earlier datasets.

`host-context.ts` implements captured decision frames, observed file revisions, host-confirmed protection policy, pending work and single-use verification tickets. It rejects stale or superseded callbacks and gates completion. It does not resolve real preview selections or invoke actual preview/export tools. The independent scoped branch supplies a captured-selection edit API tested on real JSX files.

The next implementation slice should be an opt-in adapter to the existing host/context pack, not another persisted model-written memory system:

1. Read current host selection, workspace identity and source revision through existing provenance code; unresolved objects must trigger reinspection rather than speculative ID reuse.
2. Attach preview results to the originating run/document/revision and only expose current evidence in context. Persisted old summaries must never resurrect verification.
3. Correlate model proposals to captured frames and execute edits through the actual writer lock. Verify cancellation, run ownership, selection changes, external writes and alternate mutation-tool paths.
4. Compare the existing production context pack against this adapter on independently annotated sessions with matched total input budgets and repeated trials. Run the supported background UI verification before any desktop integration is considered complete.

The remaining sections describe the original production-oriented roadmap; these integration acceptance criteria have not been claimed as completed by the research pilots.

## First implementation slice: establish a production baseline offline

Implemented: production-baseline.ts directly calls [buildDesignContextPack](../../packages/core/src/design-context.ts), with frozen synthetic production-shaped input, exact-output comparison tests and an exclusive-write JSON report CLI. No model calls are made. [Corpus/comparison protocol](./CORPUS_PROTOCOL.md) now supplies frozen synthetic materials, evaluator references, family splits, input/context binding and complete-request budget validation. Real-session intake and the model experiment below remain next work.
Convert frozen session fixtures to its real `ChatMessageRow` input and provide fixed briefs, preferences and workspace state.
Compare three conditions:
1. Full context, subject to the selected model's actual context limit.
2. The current context pack and design brief.
3. A candidate goal-conditioned context pack.

Keep recency packing only as an explanatory ablation.
The current synthetic state reducer assumes trusted acceptance/source labels; natural-language extraction must be evaluated separately.

The current pack budgets history in characters and appends brief/workspace sections separately.
Count the complete model input, including all context sections and fixed prompt overhead. Equal history limits alone do not produce equal total budgets.
Use a documented tokenizer for the selected model where available; label estimates as estimates and retain actual provider usage. Do not relabel UTF-8 byte counts as tokens.

Acceptance:
- Baseline adapter output matches direct calls to the current implementation on the same fixture.
- Questions and reference answers are never passed to the compressor.
- Contexts remain fixed while each withheld question is evaluated.
- Budget overflow, unavailable token counts and full-context overflow are explicit outcomes.

## Second slice: evolve the existing brief, not a separate memory system

Research-only Task3 is implemented in goal-state.ts and candidate-pack.ts, with [draft annotation review](./ANNOTATION_REVIEW.md) and a [state-only oracle audit](./CANDIDATE_SELECTOR.md). Source evidence and lifecycle are checked, but annotation semantics await human review. This does not implement natural-language extraction or change a persisted brief schema.


Current integration points:
- [design-context.ts](../../packages/core/src/design-context.ts): `DesignSessionBriefV1`, `updateDesignSessionBrief`, prompt and pack builder.
- [memory.ts](../../packages/core/src/memory.ts): workspace/user memory authority and derived brief cache.
- [ipc/generate.ts](../../apps/desktop/src/main/ipc/generate.ts): runtime pack construction and budget trace.
- [context-prune.ts](../../packages/core/src/context-prune.ts): last-mile oversized-payload safety fuse, not the primary summarizer.

Prototype a derived constraint record with evidence reference, scope, source revision and status (active/superseded/revoked/unresolved).
Treat this as a candidate representation first; decide whether existing brief fields suffice before changing a persisted schema.
If persisted fields are extended, define backward-compatible reads and explicit schema evolution rather than silently changing V1 semantics.

Use current workspace files for current artifact facts. Keep user intent distinct from assistant suggestions and tool observations.
Handle user revocation, design switching, stale file evidence and contradictory sources; do not turn an unresolved conflict into a confident retained fact.
Maintain existing untrusted-context boundaries. Do not replace the context-prune safety fuse with the research compressor.

Acceptance:
- A later approved decision supersedes an earlier one.
- An assistant proposal does not become an approved constraint.
- A revoked preference and stale verification cannot reappear as current truth.
- Missing or ambiguous evidence remains visible instead of being guessed.
- Empty/invalid candidate output falls back to the established context path.

## Third slice: paired model and downstream-edit experiments

Use 20 redacted multi-turn sessions with independently annotated constraints and later edit requests; split by session/design.
Freeze questions and evaluation rules before tuning compression.
Run the same fixed reader/model against current pack, candidate pack and full-context reference at equal measured/estimated budgets, with three trials.
Measure per-question accuracy and all-constraints-correct goals separately, plus extraction errors, actual token use, latency and subsequent edit violations.

Keep compressor and reader model/settings recorded separately. Account for compression cost, not only the shorter reader call.
Use observed downstream edits to check whether remembered facts actually improve behavior.
Report confidence and tradeoffs; a small synthetic perfect score is not a production promotion criterion.

## Dependency and promotion

Reuse behavior-eval reporting and later test its scoped-edit cases as downstream tasks.
First land the production-baseline adapter and corpus protocol as research code. Only consider default prompt/schema changes after held-out evidence shows fewer constraint violations without regression on legitimate edits.
