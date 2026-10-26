# Host-owned facts and model-owned goals — pilot v2

Research-only follow-up to the 2026-10-26 context pilot. This version changes both the cases and response protocol; scores must not be compared directly with v1.

## Implemented boundary

`host-context.ts` maintains canonical document/object IDs, a captured source hash, monotonically increasing **observed** source revisions, host-confirmed protection requirements, pending work, and per-check results. It reads real isolated JSX fixture files. A changed file invalidates old verification and completion. A protection/verification policy change also invalidates prior results. Starting a fresh check removes its previous pass until the new result arrives.

Preview requests receive host-only single-use tickets. Their callbacks are tied to document, observed revision, hash and policy. Old-revision callbacks are refused; older callbacks for a repeatedly requested check cannot overwrite newer results. Switching active designs does not relabel a background result. Model proposals use captured single-use frames; switching away and back, policy changes or source changes invalidate those frames rather than silently rebinding them to fresh state.

The model returns only action, canonical object ID, check names, color and font. File path, source revision/hash and protected-object IDs come from the host snapshot. Extra model-authored authority fields are refused. `done` requires all current checks passed and no pending work. An allowed `inspect` is a request description, not an actual preview invocation. Wrong preferences and unnecessary inspections can still be allowed; enforcement is not a semantic oracle or a substitute for model scoring.

The trusted inventory and user protection selections are supplied by controlled fixture setup. This pilot does not infer authorization from chat, resolve arbitrary JSX selections, or prove object identity across arbitrary source restructures. It is not installed in the desktop app. Synthetic preview callbacks are not visual verification. Disk reads do not provide a filesystem transaction against uncooperative writers; revisions track observed changes, not every possible unobserved write. An actual host adapter must own selection resolution, file transactions and authenticated tool events.

## Frozen experiment

Two newly authored multi-step scenarios, three checkpoints each:

1. Registration page: both checks passed → external file edit plus a delayed old pass → current desktop pass plus newer mobile failure and an older success callback.
2. Pricing page: revoke footer preservation, protect navigation, reverify → switch to another design, return after external pricing-file change → previews pass but export work remains pending.

Each checkpoint replays the same scripted prefix into a new directory for each arm. It is a checkpoint replay, not a free-running agent trajectory: model decisions do not change subsequent test inputs.

Compare:

- **model-record**: the model compresses user preferences, runtime observations, protection requirements and verification into one structured summary.
- **host-facts**: the model compresses only goals and preferences; current host facts are added separately to the reader's context. Tool-state messages are not given to this compressor.

Both summaries have an 1,800 UTF-8 byte cap; invalid/oversize output fails without trimming, retry or repair. Both arms use the same canonical-ID output schema, reader system prompt, catalog and host gate. Reader context is **not token/byte matched**: adding authoritative state is the intervention. The host projection contains observations, not evaluator answers or a precomputed recommended action. Each condition independently samples its summary and reader response, so single-trial differences are not paired same-output causal estimates.

## Models, budget and metrics

The previous model identities/settings are retained: `gpt-6.1-sol` with high reasoning, `qwen3:codesign-eval-4b-16k-v2`, `gemma4:codesign-eval-12b-16k-v2`. Local model digests and actual 16K runtime context are checked. No new weights, SDK or backend. The shared pi-backed call wrapper is reused from the scoped branch and the provider implementation remains pinned to behavior commit `1ea646e0`.

Six checkpoints × two arms × compressor/reader × three models = **72 calls maximum**, one trial. Each embedding config must explicitly allow 24 calls, a 240-second timeout and a requested 8,192-token output limit. Codex uses prompt-only JSON, while Ollama also receives JSON Schema. The Codex adapter may not enforce its requested server-side output cap. Usage is provider-reported, may exclude cache reads, and zero reported cost is not billing evidence.

Primary score: all five model fields correct before enforcement, plus per-field counts. IDs replace free-form protected-object labels; no post-run synonym normalization. Evaluator labels are separate from the host reducer and are never sent to compressors/readers. Additional observations: premature completion proposals, gate refusals, correct proposals refused, allowed incorrect proposals, completion effects on incomplete tasks, and visible host state changes on rejected proposals. Safe refusal is not a successful model answer. Bindings supplied by the host are an engineering invariant, not model reasoning accuracy.

Plans, source hashes and policies are frozen before the first call in each model run. Raw prompts/responses, usage, host snapshots, callback refusals and guard receipts are durable. Failures remain in the planned denominator. Two synthetic scenarios, agent-authored labels and one trial are insufficient for statistical or real-session generalization claims.

## Reproduce

`host-live.mjs` exports `runHostLive({experimentRoot, providerRoot, runnerRoot, config, apiKey, output})`. Use this branch as `experimentRoot`, behavior checkout `1ea646e0` as `providerRoot`, and scoped checkout `9605a792` (or a later compatible commit) as `runnerRoot`. Install pinned dependencies; invoke an explicit embedding script with `node --import tsx`. Supply credentials in memory or through environment variables, never config/report files. Use a new output directory with an existing parent. It writes `manifest.json`, `calls.jsonl`, `experiment/plan.json`, `experiment/results.json` and `complete.json`. The config's provider settings are reused; the dataset is the six host checkpoints and its call budget is explicitly validated as 24.

Run local controls with the existing research Vitest configuration and `tsc -p research/goal-aware-context/host.tsconfig.json`. The separate scoped branch's `bound-edit.ts` binds actual JSX mutations to a host-confirmed source selection. Its file-write tests are separate from this reader experiment; these 72 calls do not execute model-driven JSX changes or real previews.
