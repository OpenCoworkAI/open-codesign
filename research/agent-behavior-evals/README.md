# Agent behavior evals: model next-decision evaluation

Branch: `research/agent-behavior-evals`. Research runner with offline controls and explicit live-model execution; not an application evaluator.

Progress and next work: [implementation plan](./IMPLEMENTATION_PLAN.md).

## Hypothesis

Short continuations at critical design-agent decision points can expose intent violations that final artifact screenshots miss.

## What runs

20 original synthetic decision points across five categories: selection boundaries, stale evidence, preserved design constraints, evidence-backed completion and ambiguous targets.
Each has a hand-authored positive and negative continuation (40 calibration responses).
Two positive controls legitimately finish after successful verification, preventing an evaluator that simply rejects every completion from passing calibration.

The response contract describes one abstract next decision, not the application's raw pi tool-call schema.
A deterministic scorer checks action, status, exact target set, changes and source evidence. Missing responses count as failures. Unknown and duplicate IDs reject the run; doing nothing cannot satisfy an edit request.

## First observations

24 Vitest checks passed. All 20 positive controls were accepted and all 20 negative controls were rejected.
These figures measure scorer calibration against authored expectations. No model has been evaluated; there is no measured model pass rate or improvement.
This is inspired by decision-point continuation, not a reproduction of TraceDance's retrieval, LLM confirmation or benchmark.

## Reproduce

From the repository root after the normal `pnpm install --frozen-lockfile` (or a focused `pnpm --filter @open-codesign/providers... install --frozen-lockfile --ignore-scripts` for these research checks):

```bash
node packages/providers/node_modules/vitest/vitest.mjs run --config research/agent-behavior-evals/vitest.config.mjs
pnpm exec tsc -p research/agent-behavior-evals/tsconfig.json
pnpm exec biome check research/agent-behavior-evals
```

No new packages were added, and application code does not import this experiment. Tests run in Node and do not launch Electron, a browser, or a model.
This run used Windows, Git Bash, Node 24.19.0, Vitest 4.1.12 and Biome 2.4.15.
The repository recommends Node 22; this run did not validate Node 22.
The shared base is `4cf33932edc5f687e3cf7190261ebbb02c898d08`.
Generated observations stay in ignored `.Codex/workspace/agent-behavior-evals/`.

Run from the root:

```bash
node research/agent-behavior-evals/run.mjs controls
node research/agent-behavior-evals/run.mjs export
node research/agent-behavior-evals/run.mjs score responses.json
```

`export.json` contains only task IDs, prompts, context and response contract; it excludes reference decisions and rubric.
Give only this export to a model. The reference fixture file is evaluator-only.
A scored input has this form (provide one response for every exported ID):

```json
{
  "schemaVersion": 1,
  "provenance": "model name, provider, prompt variant, generation settings and trial",
  "responses": [{
    "id": "selection-1",
    "decision": {
      "action": "edit",
      "status": "pending",
      "targetIds": ["hero-title"],
      "changes": [{"field": "text", "value": "Welcome"}],
      "expectedSourceHash": "1111111111111111111111111111111111111111111111111111111111111111"
    }
  }]
}
```

Scoring writes `score.json` and exits nonzero if any response is missing or fails.
The model runner below uses the existing provider completion interface backed by pi-ai. The older `score` command remains for manually supplied single-trial inputs; model-runner reports already include multi-trial scoring.

## Run a model evaluation

Copy `model-config.example.json` to a local file under `.Codex/workspace/agent-behavior-evals/`.
Set the exact provider/model ID and the name of an environment variable containing its API key. The example model ID is deliberately a placeholder and cannot execute.
Do not place credentials in the config. This runner does not read desktop login sessions or automatically choose a model.

Preview all requests without reading credentials or loading the provider module:

```bash
pnpm exec tsx research/agent-behavior-evals/model-cli.ts \
  --config research/agent-behavior-evals/model-config.example.json \
  --output .Codex/workspace/agent-behavior-evals/preview-001
```

After editing your local configuration and setting its selected environment variable, execute:

```bash
pnpm exec tsx research/agent-behavior-evals/model-cli.ts \
  --config .Codex/workspace/agent-behavior-evals/model.config.json \
  --output .Codex/workspace/agent-behavior-evals/run-001 --execute
```

Omitting `--output` creates a unique local run directory. Explicit output directories must not exist; reruns never overwrite evidence.
Use the repository-pinned pnpm 10.33.4; `corepack pnpm` can select it if another pnpm version is injected into PATH.

Configuration:
- `model`: exact `provider` and `modelId`; no runner fallback or automatic model selection.
- `credentialEnv`: environment variable name, never a literal key.
- `promptVariant`: `baseline` or `constraint-check`; the latter adds general constraint/evidence checks, not reference answers.
- `trials`: 1–100, default 1. Each case/trial is an independent request with no conversation carryover.
- `maxCalls`: required global cap across all cases and trials. The default corpus has 20 cases, so three full trials need a cap of at least 60.
- `maxOutputTokens`: default 1024; `timeoutMs`: default 60000.
- `caseIds`: optional distinct subset for a small pilot; omitted means all 20 cases.
- Optional `baseUrl`, `wire` and `reasoning` use the existing provider interface. URLs cannot contain user/password, query or fragment. No custom header or keyless auth support is added in this slice. Omitted reasoning uses the provider's existing default behavior.

The cap counts provider-completion invocations, not hidden transport retries inside upstream libraries or dollars. The runner itself does not retry, repair JSON, strip code fences or substitute a model. A timeout requests abort and stops scheduling further calls because the remote request may still be running. Ctrl+C requests cancellation and flushes remaining rows as skipped.

## Evidence and score interpretation

Each live run writes:
- `manifest.json`: immutable run ID, normalized config, exact blind requests, fixture/prompt/config hashes, source and lockfile hashes, Git revision and dirty-state flag.
- `observations.jsonl`: a durable row after each scheduled case/trial, preserving available results if the process is interrupted.
- `report.json`: final rows and aggregate scores by category and trial, with observed usage and the count of calls lacking usage.

Rows distinguish valid decisions (`ok`, which can still fail the rubric), invalid JSON, invalid response shape, token-limit truncation, provider errors, timeout, cancellation and skipped requests.
**The denominator includes every scheduled case/trial**, including skipped calls. A deliberately capped pilot is incomplete; do not compare its overall pass rate to a full run. Hard-killed runs may have only a manifest and partial journal and must not be treated as complete reports.

Raw responses are retained except credential echoes. Provider exception text is omitted because it may contain request credentials; recognized project error codes are retained. Token-limit failures retain usage when the provider interface supplies it, but that interface does not expose partial text. Unknown usage is not inferred to be zero; aggregate fields describe observed/reported usage, and a provider-reported cost of zero is not proof of a free request.

Exit codes: `0` = successful dry run or every scheduled case passed; `1` = behavior/response-format failures; `2` = configuration, provider, truncation, timeout or call-limit failure; `130` = cancellation.

Runner validation on 2026-10-25: 56 focused Vitest checks, strict TypeScript and full-repository Biome checks; command-line dry-run exercised. Provider execution is tested at the existing completion boundary. An additional CLI smoke run used the real provider module with a deliberately unknown model ID: it produced a failed row with `PROVIDER_MODEL_UNKNOWN` and unknown usage, before any generation request. No live model endpoint was invoked and no model-quality result is claimed.

## Limits and next experiment

The scorer checks declared structured decisions, not whether tools actually execute the declaration. It intentionally uses a narrow single-step contract and may reject other reasonable strategies.
The 20 cases use template variations, so they are not 20 independent real-world observations. Positive/negative controls are handcrafted, not held-out validation.

Next: collect consented, redacted decision points from real design sessions, split by design/session rather than by template, manually adjudicate multiple acceptable continuations, and add a held-out set.
Compare current versus revised agent instructions using identical model settings and three trials per case. Report category-level behavior failures and missing/invalid output separately from artifact success. Verify a subset against actual tool events to detect claims that disagree with execution. No provider credentials are read by this branch.

## Research provenance

Conceptual inspiration: [TraceDance](https://arxiv.org/abs/2609.33295), [project page](https://zhishanq.github.io/TraceDance).
No paper dataset, benchmark cases or implementation were copied.
