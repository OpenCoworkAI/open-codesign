# Implementation plan: agent behavior evaluation

Status: first slice implemented; runtime tool-event evaluation and a held-out corpus remain proposed work.
Code inspection baseline: `4cf33932edc5f687e3cf7190261ebbb02c898d08`.
The current branch contains offline controls plus an explicit live-model runner; synthetic results remain calibration evidence, not measured model gains.
Before a production change, refresh against main and re-check these entry points.

## First implementation slice: run real continuations

Implemented in `model-runner.ts`, `model-config.ts` and `model-cli.ts`, alongside the current scorer. See the [run instructions](./README.md#run-a-model-evaluation).
Use the existing `@open-codesign/providers` completion interface for the structured next-decision experiment; it already wraps pi-ai.
Only exported blind tasks go into prompts. Keep policies, positive/negative controls and evaluator questions out of model context.

Inputs: provider/model, prompt variant, fixture set hash, trial count, output-token limit, timeout and maximum calls.
Outputs: raw response, parsed decision, parse error, provider error, usage, elapsed time and immutable run metadata.
Read explicitly selected credentials at execution time; never serialize keys/headers. A dry run lists planned requests without calling a provider.
Do not silently substitute another model, repair an invalid response into a passing one, or exclude failures from the denominator.

Acceptance:
- The existing 20 paired controls still calibrate correctly.
- Missing, truncated, invalid and failed model outputs appear explicitly in results.
- Cancellation and call limits prevent further requests.
- Same fixture/prompt hashes can be compared across runs.
- Tests mock the core/provider boundary, not a provider SDK.

Validation: 56 focused Vitest checks plus strict TypeScript and lint. The CLI dry run was exercised. A subsequent [live-model pilot](./PILOT_RESULTS.md) completed 12 requests with the locally configured Codex model, with both variants passing 6/6 synthetic cases. A harder held-out set is needed before comparing prompt quality.
The first pilot should select a small case subset, use one trial, and keep the call cap equal to its case count. Then freeze a full run before comparing prompt variants.

## Second slice: connect decisions to actual tool events

The structured response contract is currently abstract. Add a separate runtime evaluation track using:
- [generateViaAgent](../../packages/core/src/agent.ts): `deps.tools`, `deps.fs`, `onEvent`, `onComplete`.
- [smoke-models.ts](../../scripts/smoke-models.ts): existing headless generation example.
- [provider interface](../../packages/providers/src/index.ts): usage and model options.

Supply isolated temporary-workspace callbacks and an explicit toolset. Capture the first relevant decision and ensuing tool result rather than treating declared JSON as proof of execution.
The smoke script stubs runtime verification; do not report visual success based on that stub. Distinguish static, runtime and visual evidence.

Add legitimate alternative decisions to human-reviewed rubrics. A single exact expected action is appropriate for current controls but too narrow for arbitrary sessions.

## Third slice: a held-out design corpus

Collect 20 redacted design-session decision points to start, expanding beyond template variations. Separate development and held-out cases by session/design.
Cover scope expansion, stale selection, ignored brand rules, ambiguous references, failed verification and legitimate completion.
Run current and candidate prompts in paired trials with the same model/settings; start with three trials per case.

Report per-category failures, invalid/missing outputs, observed tool effects and actual token/cost data separately.
Keep hand-authored controls separate from held-out scores; do not treat repeated trials as independent sessions.

## Dependency and promotion

This runner is the first priority because the other two branches need a shared measurement method.
Initially exchange versioned JSON reports across branches; do not make the three branches depend on each other's unmerged source.
Extract shared evaluation utilities only after two real callers need them.

A first reviewable change should contain only runner/config/reporting code and focused tests. No changes to desktop defaults or model selection are needed.
