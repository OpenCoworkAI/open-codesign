# Real-model file-edit pilot (2026-10-26)

Research only. Six original synthetic JSX fixtures are written to fresh directories and edited with the existing source-edit engine. This is actual disk IO, not application integration, rendered visual evaluation, or a production permission boundary.

## Frozen comparison

For each model/case, generate one proposal and apply that identical proposal to two independent file copies:

1. Existing deterministic source-edit engine, with path containment and shape validation.
2. The same engine plus the host-owned selected-file, selected-target, allowed-field and source-revision grant.
3. If arm 2 refuses, send its operational refusal and the original selection to the same model once. No reference answer, desired output file, or evaluator diagnosis is sent. No retry for an allowed but incorrect edit.

This paired design isolates enforcement from sampling on the initial proposal. The repair arm has an extra call budget; it does not estimate the value of feedback separately from another attempt.

Cases: duplicate labels, text vs style preservation, style vs copy preservation, exact literal copy with BOM/CRLF, an attribute-only change, and an identical file outside the selected path. Each case has one requested edit. These are development fixtures with agent-authored labels, not held-out real user sessions.

Models match the earlier behavior pilot: `gpt-6.1-sol` with high reasoning, `qwen3:codesign-eval-4b-16k-v2`, and `gemma4:codesign-eval-12b-16k-v2`. The local aliases retain their previous weights and templates, with 16,384 context. One trial; at most 12 calls/model, 36 total. Calls are sequential, timeout 240 seconds, requested output cap 8,192. The Codex adapter does not guarantee enforcement of that server-side output cap. Ollama receives JSON Schema; Codex receives the same schema in its prompt. No response repair or Markdown stripping.

## Metrics

- Completion: exact requested final `App.jsx` bytes, including correct escaping by the existing engine, and an unchanged `Archive.jsx`.
- Enforcement: refusal reasons, initial successes refused, rejected proposals with zero byte changes.
- Repair: attempted follow-up calls and final completion, separate from initial completion.
- Actual provider-reported token usage, latency, malformed output, truncation and provider failures. Reported zero cost is not a billing estimate; cache-read accounting differs by provider.

Rejection is not counted as completion. A within-scope wrong string can be accepted but still fail the final-file comparison. The correct file is constructed from an independently specified operation; it is never sent to the model or guard.

## File boundary

The harness accepts only `App.jsx` and `Archive.jsx` in a host-created, single-writer directory. It rejects leaf symlinks and rechecks bytes immediately before atomic replacement. Tests exercise a detected external modification. There is still a check-to-rename race with an uncooperative external writer; this is not filesystem compare-and-swap. It does not model multi-file transactions, selection-to-preview provenance, or bypasses through other app tools.

## Reproduce

Use this branch for the engine and experiment, and a separate checkout of `research/agent-behavior-evals` at `1ea646e0` for the existing pi-backed provider implementation and JSON Schema support. Install pinned dependencies with `corepack pnpm install --frozen-lockfile` in the checkouts. No new runtime dependency is added by this pilot.

`run-live.mjs` exports `runLive({ experiment, experimentRoot, providerRoot, config, apiKey, output })`. Run an embedding script using `node --import tsx`. Set `experiment: 'scope'`; supply absolute checkout roots, a new output directory whose parent exists, and the same validated config format as the behavior runner. Supply `apiKey` in memory or from an environment variable; never include it in config or output. Model config examples live in the pinned behavior checkout. A normal installed checkout resolves engine dependencies directly. A reused dependency checkout can be selected with a temporary tsx/TypeScript path map; never change a permanent PATH.

Before the first generation, the runner saves the plan, source hashes, provider commit, config and call budget. It journals requests and responses incrementally to `calls.jsonl`, writes each actual fixture directory, and records per-case results under `experiment/results.json`. `complete.json` confirms the run finished. No overwrite, implicit retry, or model substitution.

For local models, verify `/api/tags` digests and `/api/ps` context length against the previous behavior pilot before starting. The authoring run saves those observations alongside the manifests. Private auth and local paths are excluded from the public report.
