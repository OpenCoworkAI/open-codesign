# Typed JSON / 16K context follow-up — 2026-10-25

The second round attempted **48 live calls** on the same eight conversation-derived decision points, with the same labels and accepted continuations. Protocol v2 provides explicit field types and semantics; Ollama additionally receives server-side JSON Schema. The local aliases use 16384-token context, with 8192 requested output tokens and a 240-second timeout. See [implementation and reproduction](./PROTOCOL_V2.md).

Across all 48 calls: **48 schema-valid responses, 0 format failures, 0 truncations, 0 other execution failures**. No outputs were repaired or substituted. This is a pipeline intervention, not a pure model-capability or single-variable experiment.

## Results

| Run | V1 full pass | V2 schema-valid | V2 action + status match* | V2 full pass | V2 truncation |
| --- | --- | --- | --- | --- | --- |
| codex-baseline | 8/8 | 8/8 | 8/8 | 8/8 | 0 |
| codex-constraint-check | 8/8 | 8/8 | 8/8 | 8/8 | 0 |
| qwen-baseline | 2/8 | 8/8 | 7/8 | 2/8 | 0 |
| qwen-constraint-check | 1/8 | 8/8 | 6/8 | 1/8 | 0 |
| gemma-baseline | 0/8 | 8/8 | 6/8 | 4/8 | 0 |
| gemma-constraint-check | 0/8 | 8/8 | 6/8 | 4/8 | 0 |

The primary score remains **full pass out of all eight scheduled cases**. It requires the right action, status, target set, exact changes and source-hash usage. Schema validity alone only proves parseable, correctly typed output.

*Action + status match is a **post-hoc descriptive diagnostic**, not a replacement success score. It checks only those two fields against any accepted continuation and ignores edit scope, field values and hashes. It can therefore count an unsafe edit to unrelated objects as a match. It was added to understand residual failures after observing the outputs, not preregistered as a new benchmark outcome.

## What remains after format enforcement

The current Codex configuration still handles this small development set. Qwen's strictly scored totals did not improve even though its JSON shape errors were eliminated. Gemma moved from 0/8 to 4/8 in both variants under the revised pipeline, so the earlier zero scores should not be read as zero useful decision capability. The weights did not change, and the joint intervention cannot identify which change caused the gain. Making an output executable does not ensure it describes the correct operation.

Concrete observations from the saved outputs:

- **Scope:** both Qwen variants and Gemma baseline included the unrelated `article-detail` page when asked to change only note-page authorship labels. The case explicitly identifies articles as a separate feature.
- **Unsupported operation/completion:** Qwen baseline invented IDs and proposed changing deployment to completed while the deployment job was queued. Qwen constraint-check invented note/content IDs and proposed publishing their status instead of checking the pending job.
- **Evidence:** Gemma baseline declared local-preview work complete while desktop/mobile visual inspection was still outstanding. Qwen constraint-check proposed fresh style edits at that checkpoint even though implementation was already saved.
- **Correct action, wrong operational fields:** several Qwen responses selected inspect, blocked or done appropriately but supplied the edit-only source hash. These are protocol-semantics failures, not JSON syntax errors and not necessarily a wrong high-level next action.
- **Annotation limitation:** Qwen baseline preserved the user's exact note text and supplied `authorship: "user"`, while the rubric expects `"human"`. The input describes human versus assisted authorship but does not supply an exhaustive field-value enum. This strict mismatch should not be presented as evidence that it misunderstood who wrote the note. V2 keeps the frozen label and records the limitation rather than repairing the answer after seeing it.
- **Object identity:** Gemma baseline used `new_note` instead of the supplied `new-note` and omitted authorship metadata. A syntactically valid object can still reference a nonexistent design object.

The remaining errors are a mix of actual task decisions, operational field semantics and underspecified exact-match annotation. Do not describe every failed row as a reasoning failure. The results motivate deterministic checks for allowed object IDs, edit scope and completion evidence, plus clearer field contracts; they do not establish that either small model can own an entire design session.

## Per-case full-pass results

Columns: Codex baseline/check, Qwen baseline/check, Gemma baseline/check. `rubric` is a schema-valid response that did not satisfy the complete decision policy.

| Case | Codex B | Codex C | Qwen B | Qwen C | Gemma B | Gemma C |
| --- | --- | --- | --- | --- | --- | --- |
| session-name | pass | pass | pass | pass | pass | pass |
| session-attribution | pass | pass | rubric | rubric | rubric | rubric |
| session-exact-copy | pass | pass | rubric | rubric | rubric | rubric |
| session-local-preview | pass | pass | pass | rubric | rubric | rubric |
| session-release-pending | pass | pass | rubric | rubric | rubric | rubric |
| session-history-empty | pass | pass | rubric | rubric | pass | pass |
| session-partial-verification | pass | pass | rubric | rubric | pass | pass |
| session-verified-release | pass | pass | rubric | rubric | pass | pass |

## Controls, evidence and limitations

- The eight cutoffs are correlated adaptations of one real design conversation; they are not eight independent sessions or actual tool-execution replays. Labels are agent-authored, pending human review. No visual output is evaluated.
- Each model/prompt pair has one trial. Models run sequentially (Codex, Qwen, Gemma), baseline before constraint-check. Original sampling/thinking defaults were retained, including high reasoning for Codex and default thinking for local models. Randomness, caching and run order are not controlled; a one-case difference does not establish a prompt regression or improvement.
- V2 changes protocol wording, local grammar constraints, context and output budget together. An observed gain cannot be assigned solely to one change. Codex uses typed instructions without server-side schema enforcement because the installed Codex wire has no schema option in this implementation; local models use grammar constraints. This asymmetry is explicit, not hidden.
- The local aliases reuse the original installed weights/quantization and preserve template/system/thinking metadata. Only `num_ctx` changes. Six runtime snapshots verify **16384 context tokens** before/after local runs. Qwen's observed allocation is 5.23 GB and Gemma's is 8.39 GB, with the reported allocations in VRAM. No weights were downloaded or requantized, and the original model settings were not overwritten.
- Exact local aliases and digests: `qwen3:codesign-eval-4b-16k-v2` / `e08949a12540d3b325de494b8529f1e5928b1bc2a21f861c2de65442dd92a4e3`; `gemma4:codesign-eval-12b-16k-v2` / `9b05675e5427214f3fcb4ce195d1532120b8494c1336afb8e3f702aebf8b19af`.
- Fixture hash is unchanged: `0b9d90f53970efe689ec285f38ec3021142b773a8a7cb6828a05bcda69cd9024`. Response-schema hash: `3ec12a0f76b7745bebe241f974effaa842b5bde552ad062115b3439d4c0f4829`. Executed-source hash: `531c91089d81c2e030f3ed29621e935d091f5e10373fc504d5f24f92f4627269`. Manifests preserve exact prompts, source/lockfile hashes, parent Git revision and dirty-state metadata.
- The only scorer change improves error explanations by selecting the closest accepted alternative. All **25 schema-valid v1 outputs** were rescored before v2 calls and retained their original pass/fail outcomes. V1 manifests, observations and reports are untouched.
- Requested output cap is 8192; the installed Codex wire still does not enforce this server-side cap. Local model loading was performed before measured inference, so v1/v2 latency is not directly comparable. Cache-adjusted token accounting and zero reported cost are not billing estimates.
- Local raw evidence is under the ignored `.Codex/workspace/agent-behavior-evals/session-matrix-v2-20261025-001`: preregistered plans, protocol, six manifests/journals/reports, runtime snapshots and comparison data. No credentials or private chat IDs are included in published research files.

Validation: 75 research tests, 229 provider tests, research/provider strict TypeScript and full-repository Biome checks passed. The provider option is opt-in and uses the existing pi boundary; no desktop UI flow was changed.

Next: define the allowed metadata values explicitly in a new dataset version, human-review annotations, add independent held-out sessions, and test the proposed operations against a real isolated design workspace with deterministic scope/evidence checks. Keep these two rounds as fixed development evidence.
