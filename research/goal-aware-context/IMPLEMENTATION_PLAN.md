# Implementation plan: goal-aware context using the existing design brief

Status: proposed next work, not implemented by this document.
Code inspection baseline: `4cf33932edc5f687e3cf7190261ebbb02c898d08`.
The current branch contains a runnable offline experiment; its synthetic results are calibration evidence, not measured model gains.
Before a production change, refresh against main and re-check these entry points.

## First implementation slice: establish a production baseline offline

Add a research adapter around [buildDesignContextPack](../../packages/core/src/design-context.ts).
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
