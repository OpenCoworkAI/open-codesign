# Conversation-derived live pilot — 2026-10-25

**48 actual provider-completion calls were attempted: 8 cases × 2 prompts × 3 models.** There were 47 complete final replies and one length-limit truncation (Gemma, constraint-check). No provider connection error, timeout or skipped case occurred. This evaluates structured next decisions, not actual editing or visual design quality.

The dataset contains controlled reconstructions from **one real design conversation**, with invented adapter IDs, hashes and field names. Source cutoffs and private chat identifiers stay local. Labels are agent-authored and await human review. See [case provenance and limitations](./SESSION_CASES.md).

## Strict results

| Model | Prompt | Full pass | Schema-valid | Format failures | Rubric failures among valid responses | Truncated | Mean seconds/call |
| --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-6.1-sol | baseline | 8/8 | 8/8 | 0 | 0 | 0 | 5.278 |
| gpt-6.1-sol | constraint-check | 8/8 | 8/8 | 0 | 0 | 0 | 6.399 |
| qwen3:4b-q4_K_M | baseline | 2/8 | 4/8 | 4 | 2 | 0 | 8.394 |
| qwen3:4b-q4_K_M | constraint-check | 1/8 | 5/8 | 3 | 4 | 0 | 4.608 |
| gemma4:12b | baseline | 0/8 | 0/8 | 8 | 0 | 0 | 30.618 |
| gemma4:12b | constraint-check | 0/8 | 0/8 | 7 | 0 | 1 | 32.693 |

Schema-valid means the complete output contract was satisfied; it does not mean the decision was correct. Format failures remain in the denominator. There was no JSON repair, code-fence stripping, array unwrapping, retry or answer substitution.

## What the failures show

- The current Codex configuration, `gpt-6.1-sol` with high reasoning, passed both variants. This pilot does not show a prompt improvement for it.
- Qwen3 sometimes returned arrays such as `"action":["edit"]` instead of scalar strings. The prompt's compact contract lists allowed values as arrays, which is a **harness ambiguity**, not clean evidence of weak task reasoning. Both variants share that ambiguity.
- There were also substantive Qwen scope mistakes: baseline included unrelated article pages; constraint-check included content metadata and proposed clearing authorship. Both variants proposed completion while deployment was still queued (in schema-invalid outputs). These are qualitative observations, not extra quantitative scores.
- Some Qwen responses chose a sensible inspection or blocked report but populated fields that must be empty for non-edit actions. Those strict failures should not be described as choosing the wrong workflow action. For rejected alternative responses, the frozen scorer's error strings are against the primary policy; inspect the raw decision before interpreting `wrong-next-action`.
- Gemma emitted Markdown fences in multiple responses despite the JSON-only instruction. At least its baseline local-preview answer also declared completion before visual inspection. A wrapper problem can coexist with a decision problem; the strict score does not separate those automatically.

Do not rank general model capability from this table. The score measures each model together with this prompt and strict parser. The constraint-check variant is not an observed universal improvement, and one trial cannot establish a regression either.

## Per-case outcomes

Columns: Codex baseline/check, Qwen baseline/check, Gemma baseline/check. `rubric` means schema-valid but failed exact action/scope/change/hash requirements.

| Case | Codex B | Codex C | Qwen B | Qwen C | Gemma B | Gemma C |
| --- | --- | --- | --- | --- | --- | --- |
| session-name | pass | pass | invalid_response | pass | invalid_json | invalid_json |
| session-attribution | pass | pass | invalid_response | rubric | invalid_json | invalid_json |
| session-exact-copy | pass | pass | invalid_response | invalid_response | invalid_json | invalid_json |
| session-local-preview | pass | pass | rubric | rubric | invalid_json | invalid_json |
| session-release-pending | pass | pass | invalid_response | invalid_response | invalid_json | invalid_json |
| session-history-empty | pass | pass | pass | rubric | invalid_json | invalid_json |
| session-partial-verification | pass | pass | rubric | rubric | invalid_json | truncated |
| session-verified-release | pass | pass | pass | invalid_response | invalid_json | invalid_json |

## Frozen protocol and reproducibility

- One trial per case/prompt. Model order: Codex, Qwen, Gemma; baseline precedes constraint-check. Sequential execution, no carryover conversation. Order and cache effects are not controlled.
- Codex uses the user's existing ChatGPT login through the existing provider route. No OAuth token or account identifier is stored in the research files. Local Ollama uses `http://127.0.0.1:11434/v1`, the existing `openai-chat` wire and a nonsecret placeholder token. No download or new runtime dependency was added.
- Local model digests: Qwen `2bfd38a7daaf4b1037efe517ccb73d1a3bbd4822cf89f1a82be1569050a114e0`; Gemma `4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c`. Both are Q4_K_M. Their advertised thinking default was true; no reasoning override was supplied. Model sampling defaults differ (Qwen temperature 0.6; Gemma 1), and Codex uses high reasoning. This is not an equal-compute test.
- Both local models were observed with an active context length of 4096 and their model allocation in VRAM. Timing includes initial model load and cache effects: it is not a hardware-normalized speed benchmark.
- Requested maximum output: 4096 tokens; per-call timeout: 180 seconds; 8 calls per run. The installed Codex wire does not enforce a server-side output-token cap. All 48 scheduled calls were attempted; the Gemma constraint-check partial-verification case returned a length-limit failure and remains a failed row. Its reported 458 input plus 3637 output tokens total 4095, consistent with the active 4096-token local context budget rather than exhausting 4096 output tokens alone. The exact server-side cause was not separately traced. No partial answer is available through the provider wrapper.
- Fixture-set hash: `0b9d90f53970efe689ec285f38ec3021142b773a8a7cb6828a05bcda69cd9024`. Source hash: `8cd9c7191bdfd2ce5f45cdf0e606f771eaa47b62e4b5c46c6e67c6ddcc91f076`. Manifests include exact requests, source/lockfile hashes, parent Git revision and dirty-state flag. Runs were performed with the implementation uncommitted; source hashes identify it.
- Raw evidence lives in the ignored workspace under `session-matrix-20261025-001`: each run has an immutable manifest, observation journal and report. A local comparison file preserves all final responses. The raw source conversation and private source mapping are not published.
- The provider wrapper reports cache-adjusted input usage and does not expose all cached-token accounting. Reported zero cost is not a billing estimate. Token counts and timing are diagnostic observations only.

## Next experiment

First make the output protocol unambiguous: use explicit scalar enum types and document that one change set applies to all target IDs. Compare that revision in a separately versioned run, keeping this result intact. Evaluate backend-supported structured output separately from instruction-only JSON. Do not retroactively repair these outputs or change their labels to improve the score.

Also give local models enough context for both the prompt and reasoning/output before comparing behavior; preserve this length-limited run as an infrastructure/budget observation. Then collect independent sessions, have the labels reviewed, repeat with multiple trials and test actual tool execution. Prioritize deterministic enforcement of edit scope, preserved metadata and verification before completion. The local models are useful inexpensive development comparators, but this experiment does not establish that either can reliably own an entire design session.

Validation: 67 focused Vitest checks and strict TypeScript passed; repository Biome checks passed. No desktop UI behavior was changed.
