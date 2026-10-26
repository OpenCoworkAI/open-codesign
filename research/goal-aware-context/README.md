# Goal-aware context: structured-state ablation

Branch: `research/goal-aware-context`. Research-only, with no changes to pi compaction or persisted application memory.

Next work: [implementation plan](./IMPLEMENTATION_PLAN.md).

The next [host-owned facts pilot](./HOST_PROTOCOL.md) separates model-compressed goals/preferences from program-maintained identities, observed source revisions and verification state. It exercises two multi-step scenarios at six checkpoints and a host gate that rejects stale callbacks and premature completion. See [results](./HOST_RESULTS.md); the v1 results below remain unchanged.

The v2 run completed 70 real calls. Raw all-fields-correct scores (model-record → host-facts) were Codex 6/6 → 6/6, Qwen 3/6 → 6/6, Gemma 5/6 → 6/6. Qwen's two over-budget summaries count as failures, so this difference is partly budget compliance. No live premature completion or gate refusal occurred; independent controls test enforcement. These are checkpoint replays, not an autonomous end-to-end desktop run.

## Real-model pilot (2026-10-26)

A separate [live protocol](./LIVE_PROTOCOL.md) compares full histories, model-generated ordinary summaries and model-generated current-goal records across the same Codex, Qwen and Gemma models. Four original synthetic conversations cover superseded requirements, revocation, stale verification and design switching. Both compressed conditions have a 1,800-byte cap; the reader prompt stays identical and compression does not receive evaluator questions or labels. See [live results](./LIVE_RESULTS.md) for observed outcomes and limitations. This does not change application compaction or persisted memory.

All models passed 4/4 full-history cases. Strict ordinary-summary / goal-record scores were Codex 4/4 / 3/4, Qwen 2/4 / 3/4, and Gemma 1/4 / 1/4. Several failures were naming/translation differences; others were actual omissions or cross-design confusion. The report reviews these separately without changing frozen scores. Goal records did not consistently outperform ordinary summaries, and generating a summary increased total work for a single resumption. Host-owned revision/verification fields are the next integration candidate.

The deterministic observations below are the original structured-event experiment, not live-model results.

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
node apps/desktop/node_modules/vitest/vitest.mjs run --config research/goal-aware-context/vitest.config.mjs
```

No new packages were added, and application code does not import this experiment. Tests run in Node and do not launch Electron, a browser, or a model.
To reuse an existing checkout's installed dependencies without changing either lockfile:

```bash
RESEARCH_DEPENDENCY_ROOT="/absolute/path/to/installed-checkout" \
  node "/absolute/path/to/installed-checkout/apps/desktop/node_modules/vitest/vitest.mjs" \
  run --config research/goal-aware-context/vitest.config.mjs
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
