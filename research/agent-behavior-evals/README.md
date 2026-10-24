# Agent behavior evals: next-decision calibration

Branch: `research/agent-behavior-evals`. Offline research; not an application evaluator.

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

From the repository root after the normal `pnpm install --frozen-lockfile`:

```bash
node apps/desktop/node_modules/vitest/vitest.mjs run --config research/agent-behavior-evals/vitest.config.mjs
```

No new packages were added, and application code does not import this experiment. Tests run in Node and do not launch Electron, a browser, or a model.
To reuse an existing checkout's installed dependencies without changing either lockfile:

```bash
RESEARCH_DEPENDENCY_ROOT="/absolute/path/to/installed-checkout" \
  node "/absolute/path/to/installed-checkout/apps/desktop/node_modules/vitest/vitest.mjs" \
  run --config research/agent-behavior-evals/vitest.config.mjs
```

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
Model generation is not implemented here; use the existing pi-ai integration, not a second provider SDK.

## Limits and next experiment

The scorer checks declared structured decisions, not whether tools actually execute the declaration. It intentionally uses a narrow single-step contract and may reject other reasonable strategies.
The 20 cases use template variations, so they are not 20 independent real-world observations. Positive/negative controls are handcrafted, not held-out validation.

Next: collect consented, redacted decision points from real design sessions, split by design/session rather than by template, manually adjudicate multiple acceptable continuations, and add a held-out set.
Compare current versus revised agent instructions using identical model settings and three trials per case. Report category-level behavior failures and missing/invalid output separately from artifact success. Verify a subset against actual tool events to detect claims that disagree with execution. No provider credentials are read by this branch.

## Research provenance

Conceptual inspiration: [TraceDance](https://arxiv.org/abs/2609.33295), [project page](https://zhishanq.github.io/TraceDance).
No paper dataset, benchmark cases or implementation were copied.
