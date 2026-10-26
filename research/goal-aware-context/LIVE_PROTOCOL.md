# Real-model context pilot (2026-10-26)

Research only. Four original synthetic Chinese design conversations test superseded color choices, a revoked preservation constraint, verification invalidated by a new file revision, and switching between designs. They contain intermediate layout diagnostics, but are modest histories, not a long-context benchmark or real user session replay.

## Frozen comparison

Each of the same three models independently handles all conditions:

1. Read the full history.
2. Produce an ordinary narrative summary, then answer from that summary in a fresh call.
3. Produce a structured current-goal record, then answer from that record in a fresh call.

Both compressors receive only the same conversation and active goal. They do not receive the downstream questions or expected answers. Both have a hard cap of 1,800 UTF-8 bytes in the decoded summary; oversize or invalid summaries fail the condition without truncation or regeneration. This is equal byte caps, not equal model token budgets or matched actual summary lengths. A shorter input is not sufficient evidence of lower total cost: compression calls are included in usage.

The reader prompt is identical across conditions. It requests current color, font, preservation object, source revision, next action, and pending/failed checks. Independent labels live in `live-rubric.mjs`; comparisons are exact, except check-array ordering. Invalid shape fails all fields. Full-condition success requires all six fields, and individual field scores are also reported. One sampled summary and one reader call per compressed condition; no best-of selection or self-repair.

Models: `gpt-6.1-sol` (high), `qwen3:codesign-eval-4b-16k-v2`, `gemma4:codesign-eval-12b-16k-v2`. One trial, 20 calls/model, at most 60 total including compression. Local context 16,384, requested output cap 8,192, timeout 240 seconds. Local model weights/templates and sampling defaults are unchanged from the behavior pilot. Codex has prompt-only JSON; Ollama also has server-side JSON Schema. Codex's adapter may not enforce the output cap. Model order is fixed; condition order rotates by session. No statistical significance claim.

## Evidence and limitations

Requests, raw responses, model-reported input/output tokens and elapsed times are journaled. Plans and source hashes are saved before model calls. Invalid summaries and model failures remain in the planned denominator. Zero reported cost is not proof of free execution, and cache-read tokens may not be represented in the provider wrapper's input count.

These are agent-authored development fixtures with explicit simulated workspace observations. There is no independently reviewed real-session annotation or held-out generalization claim. The structured prompt itself tells the compressor what types of facts to preserve; there is no claim that it discovers goals without guidance. Ordinary summary is a generic LLM baseline, not pi's production compaction. Results test retrieval and next-step reporting, not actual design-edit quality or a deployed memory store.

## Reproduce

Use `live-experiment.mjs` through its exported `contextExperiment(newOutputDirectory, call)`; `call(id, messages, schema)` supplies the existing provider boundary and returns `{status, value}`. It never receives evaluator labels.

For the same bounded provider runner, use `research/scoped-design-edits`'s `run-live.mjs` export `runLive` with `experiment: 'context'`, this checkout as `experimentRoot`, and the behavior branch at `1ea646e0` as `providerRoot`. Install pinned dependencies and invoke the embedding script with `node --import tsx`. Supply the prior model config and credentials in memory. Use a new output path, never a previous run directory. See the scoped branch's `LIVE_PROTOCOL.md` for provider setup and local model verification. The context implementation itself has no dependency on the scoped editor.

The run writes `manifest.json`, `calls.jsonl`, `experiment/plan.json`, `experiment/results.json`, and `complete.json`. The source fixtures, compressors and rubric are separate so questions/answers stay outside compression inputs. Application pi compaction, UI and persisted session memory are unchanged.

The embedding runner reuses only the behavior config's model connection, wire and reasoning settings. Its legacy dataset and `maxCalls` are not this pilot's budget; the top-level manifest and protocol define 20 calls per model. The shared runner is available at scoped branch commit `9482a909`; its source hashes are also preserved in that branch's live observations.
