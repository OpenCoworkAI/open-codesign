# File scope real-model pilot results

Run date: 2026-10-26 (Asia/Shanghai). Protocol: [LIVE_PROTOCOL.md](./LIVE_PROTOCOL.md). Auditable model requests, outputs and observations: [LIVE_OBSERVATIONS.json](./LIVE_OBSERVATIONS.json).

| Model | Initial completion, engine | Initial completion, scoped | Refused | Repair calls | Final scoped completion | Correct initial edits refused | Refusals with writes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| gpt-6.1-sol | 6/6 | 6/6 | 0 | 0 | 6/6 | 0 | 0 |
| qwen3:codesign-eval-4b-16k-v2 | 6/6 | 6/6 | 0 | 0 | 6/6 | 0 | 0 |
| gemma4:codesign-eval-12b-16k-v2 | 5/6 | 5/6 | 1 | 1 | 5/6 | 0 | 0 |

Codex and Qwen completed all six cases on their first proposals. Gemma failed the style-only case: its expectedSourceHash differed from the observed file hash, and its one repair was still incorrect. Both the existing engine and the scoped wrapper refused it. Neither attempt wrote a file. This is not an additional scope-specific interception.

There was no completion improvement from the scope wrapper or the one repair in this small sample. The pilot validates real-file execution and preservation checks; it does not establish better model behavior. Existing deterministic adversarial controls separately demonstrate why authorization matters (e.g. an identical source at an unauthorized path), but those controls are not live-model errors and are not mixed into this table.

The six cases are easy, explicit single-edit tasks and have a ceiling effect for two models. No rendering, desktop invocation, concurrent-writer transaction guarantee or real-session generalization was tested. Rejection is counted separately from completion.

## Call and usage accounting

| Model | Actual calls | JSON parsed | Reported input tokens | Reported output tokens | Total model-call seconds |
| --- | ---: | ---: | ---: | ---: | ---: |
| gpt-6.1-sol | 6 | 6 | 7545 | 460 | 46.5 |
| qwen3:codesign-eval-4b-16k-v2 | 6 | 6 | 7026 | 3728 | 36.7 |
| gemma4:codesign-eval-12b-16k-v2 | 7 | 7 | 8343 | 6960 | 159.3 |

Usage comes from the existing provider wrapper and may exclude cache-read input. Reported zero cost is not a bill. Codex uses prompt-only JSON with high reasoning; Ollama also receives JSON Schema. Local aliases, weights, templates and 16K runtime context were verified before the run; provider implementation is pinned to behavior branch commit `1ea646e0`. The Codex adapter may not enforce the requested output cap.

## Validation and next step

28 scoped research tests, focused strict TypeScript checking, full-checkout Biome (799 files), and whitespace checks passed before publication. Initial setup failures (a relative dependency-root path and module exports unsupported by this source engine) were fixed before the first model call; no failed model run was discarded. Node 24.19.0 was used; Node 22 was not retested.

Next: add frozen multi-step and ambiguous-selection cases and compare feedback against an equally budgeted retry without feedback. A production proposal must establish real selection provenance and serialize writes at the actual tool boundary.
