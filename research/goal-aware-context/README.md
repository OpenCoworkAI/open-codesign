# Goal-aware context: structured-state ablation

Branch: `research/goal-aware-context`. Research-only, with no changes to pi compaction or persisted application memory.

Progress: production adapter and [corpus/comparison protocol](./CORPUS_PROTOCOL.md) are implemented. An evidence-aware draft oracle selector is now available; natural-language extraction and model/downstream experiments remain next in the [implementation plan](./IMPLEMENTATION_PLAN.md).

## Evidence-aware draft selector

Task3 adds [evidence-aware lifecycle/selection](./CANDIDATE_SELECTOR.md) and 52 source-linked AI draft records for 8 development checkpoints. All remain pending human review; see [the review checklist](./ANNOTATION_REVIEW.md). The state-only oracle condition handles replacement, revocation, unresolved conflicts and stale revisions, with explicit budget/fallback metadata. It is not model extraction or measured quality improvement. The frozen Task2 corpus/references/manifest and heldout annotations are unchanged.

## Frozen corpus and comparison rules

The offline protocol now includes 8 original synthetic sessions (400 rows), 10 checkpoints and 35 evaluator-only evidence answers, a connected-session/design split manifest, input/context hashes, complete-request budget checks and structured scoring. There are 6 development sessions and 2 reserved heldout sessions. These are protocol-regression materials, not independently annotated real-session evidence.

Run the offline audit as described in [the protocol](./CORPUS_PROTOCOL.md). It calls the unchanged production pack and records estimates for all request sections; it makes no model calls and reports no model-quality score. The protocol specifies fixed tiers, scoring/failure rules, holdout limits and the real-session intake checklist.

## Production baseline adapter

The research adapter now calls the real [buildDesignContextPack](../../packages/core/src/design-context.ts) without changing its selection, clarification handling, or character-budget rules. Tests compare the complete output with direct production calls.

- `production-baseline.ts`: typed, synchronous adapter using the existing input/output contracts.
- `production-fixtures.ts`: a deterministic synthetic conversation in the real `ChatMessageRow` format, with a fixed brief, preferences and workspace/resource state. Each call returns fresh input objects.
- `run-production-baseline.ts`: exports the exact input and context pack, including the existing trace. Importing the module does not execute the CLI.

The sample is synthetic calibration input, not a real session or a model-quality result. It does not import withheld questions or reference answers. The report's trace counts characters, not model tokens; it is not a measurement of the complete provider request. The complete-request budget interface and comparison rules are defined in the corpus protocol; actual model-token measurements and candidate compression remain future work.

From the repository root with Node 22 and pnpm 10.33.4:

```bash
pnpm --filter @open-codesign/core... install --frozen-lockfile --ignore-scripts
pnpm exec tsx --tsconfig research/goal-aware-context/tsconfig.json \
  research/goal-aware-context/run-production-baseline.ts \
  .Codex/workspace/goal-aware-context/production-run-001/report.json
pnpm exec tsc -p research/goal-aware-context/tsconfig.json
pnpm exec biome check research/goal-aware-context
```

Choose a new output file for every run. Existing output files are refused rather than overwritten. The runner performs no model calls and reads no provider credentials.

The research Vitest config resolves workspace packages to this checkout's real source entry points. `RESEARCH_DEPENDENCY_ROOT` can still supply installed runtime dependencies; it does not select another checkout's production source. The full research test suite, strict TypeScript and the CLI commands above require the local frozen install.

## Hypothesis

Explicitly preserving accepted design decisions for the active goal may retain constraints better than selecting recent history alone under a fixed context budget.

## Protocol

Six original synthetic histories; four withheld questions per history (24 total).
Histories mix superseded decisions, approved colors/fonts, rejected styles, current workspace revisions, unrelated designs and unaccepted proposals.
The order varies: early constraints, split early/late constraints, or recent constraints.

Compare:
1. Full history as the reference ceiling.
2. Recency packing: newest complete events that fit.
3. Goal state: latest accepted user/workspace facts for the active design, then pack them under the same budget.

Compressors receive history, a high-level goal and a byte budget. They do not import or receive downstream questions or answers.
The same deterministic reader evaluates all conditions. It checks questions separately against the same frozen compressed context.

This is a structured-state experiment: source/acceptance labels are supplied by synthetic fixtures. It does not solve extraction of those labels from natural-language sessions.
Recency packing is a deliberately simple baseline, not the existing pi summarizer.
Budgets are **UTF-8 bytes, not model tokens**. The 10%, 25% and 50% conditions therefore cannot be compared numerically with GACC-Bench token-budget results.

## First observations

10 Vitest checks passed. 42 session/condition rows, with no budget violations.

| Condition | Correct answers | Entire goals correct |
| --- | ---: | ---: |
| Full context | 24/24 | 6/6 |
| Recency, 10% bytes | 12/24 | 2/6 |
| Goal state, 10% bytes | 24/24 | 6/6 |
| Recency, 25% bytes | 16/24 | 2/6 |
| Goal state, 25% bytes | 24/24 | 6/6 |
| Recency, 50% bytes | 16/24 | 2/6 |
| Goal state, 50% bytes | 24/24 | 6/6 |

The fixture design favors preserving old constraints; these numbers establish protocol behavior, not generalization or LLM quality.
Additional controls cover tiny budgets, non-ASCII byte accounting, latest accepted values, ignored assistant/tool proposals, goal switching and immutable input.

## Reproduce

From the repository root after the normal `pnpm install --frozen-lockfile`:

```bash
node packages/core/node_modules/vitest/vitest.mjs run --config research/goal-aware-context/vitest.config.mjs
```

No new packages were added, and application code does not import this experiment. Tests run in Node and do not launch Electron, a browser, or a model.
To run only the original byte-budget calibration with an existing checkout's installed dependencies, without changing either lockfile:

```bash
RESEARCH_DEPENDENCY_ROOT="/absolute/path/to/installed-checkout" \
  node "/absolute/path/to/installed-checkout/packages/core/node_modules/vitest/vitest.mjs" \
  run --config research/goal-aware-context/vitest.config.mjs \
  research/goal-aware-context/experiment.test.mjs
```

This run used Windows, Git Bash, Node 24.19.0, Vitest 4.1.12 and Biome 2.4.15.
The repository recommends Node 22; this run did not validate Node 22.
The shared base is `4cf33932edc5f687e3cf7190261ebbb02c898d08`.
Generated observations stay in ignored `.Codex/workspace/goal-aware-context/`.

Run the comparison:
```bash
node research/goal-aware-context/run.mjs
```

`results.json` includes per-question predictions and both aggregate metrics.
Keep `questions.mjs` evaluator-only when introducing a model compressor.

## Next experiment

Use 20 consented, redacted multi-turn design sessions with independently annotated constraints and later edit tasks.
Freeze questions before choosing compressors; split by session. Compare full context, existing pi compaction and goal-conditioned summarization at equal actual model-token budgets.
Use one fixed reader/model version and report question accuracy, all-constraints-correct goals, token use, latency and next-edit constraint violations. Repeat model conditions three times.

Evaluate extraction errors and stale/superseded state explicitly, including user revocations and workspace facts that contradict old requests. The current last-accepted-event rule is intentionally incomplete for those cases.
No model or paid endpoint was invoked. A production integration should reuse pi/session primitives and existing workspace authority instead of introducing a separate agent-written memory store.

## Research provenance

Protocol inspiration: [GACC-Bench](https://github.com/weiting24/GACC-Bench), [paper](https://arxiv.org/abs/2610.21893).
No benchmark data or upstream implementation was copied.
