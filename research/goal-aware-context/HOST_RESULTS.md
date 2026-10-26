# Host facts v2 — real-model results

Pilot initiated 2026-10-26; completed 2026-10-27 (Asia/Shanghai). [Protocol](./HOST_PROTOCOL.md) · [Raw evidence](./HOST_OBSERVATIONS.json). Two synthetic multi-step scenarios, six replay checkpoints, one trial per model/condition. The earlier v1 scores remain unchanged.

| Model | Condition | All five fields correct | Correct fields | Premature done | Gate refusals | Correct decisions refused | Incorrect decisions allowed |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| codex | model-record | 6/6 | 30/30 | 0 | 0 | 0 | 0 |
| codex | host-facts | 6/6 | 30/30 | 0 | 0 | 0 | 0 |
| qwen | model-record | 3/6 | 19/30 | 0 | 0 | 0 | 1 |
| qwen | host-facts | 6/6 | 30/30 | 0 | 0 | 0 | 0 |
| gemma | model-record | 5/6 | 29/30 | 0 | 0 | 0 | 1 |
| gemma | host-facts | 6/6 | 30/30 | 0 | 0 | 0 | 0 |

| Model | Condition | Invalid/oversize summaries | Valid reader responses | Correct among valid reader responses |
| --- | --- | ---: | ---: | ---: |
| codex | model-record | 0 | 6 | 6/6 |
| codex | host-facts | 0 | 6 | 6/6 |
| qwen | model-record | 2 | 4 | 3/4 |
| qwen | host-facts | 0 | 6 | 6/6 |
| gemma | model-record | 0 | 6 | 5/6 |
| gemma | host-facts | 0 | 6 | 6/6 |

The raw score is calculated before enforcement. Gate refusals are not added to model correctness. A permitted partial inspection can still fail the instructed full-check-list rubric; it is not necessarily an unsafe operation. Neither arbitrary preferences nor optimal next-step choices are proved by the gate.

## Per-error evidence

- **qwen / signup-external-edit / model-record**: status ok; wrong fields checks. Proposal: `{"action":"inspect","objectId":"signup/page","checks":["mobile"],"color":"#123456","font":"Inter"}`. Gate: allowed. Summary length: 508 UTF-8 bytes.
- **qwen / pricing-policy-ready / model-record**: status invalid-summary; reader skipped and all fields receive zero credit. Proposal: `null`. Gate: not assessed. Summary length: 2725 UTF-8 bytes.
- **qwen / pricing-pending-work / model-record**: status invalid-summary; reader skipped and all fields receive zero credit. Proposal: `null`. Gate: not assessed. Summary length: 4370 UTF-8 bytes.
- **gemma / signup-ready / model-record**: status ok; wrong fields action. Proposal: `{"action":"report-blocked","objectId":"signup/page","checks":[],"color":"#123456","font":"Inter"}`. Gate: allowed. Summary length: 565 UTF-8 bytes.

## Engineering observations

Every model decision used the same canonical-ID protocol with no model-supplied source hash/path/revision. Accepted receipts bind these fields and protected-object IDs from the captured host state. These metadata invariants are supplied by code, not points credited to model reasoning. No observed premature completion was emitted by the gate, and every refused proposal preserved the visible host snapshot.

There were **zero live premature-completion proposals and zero live gate refusals**. This batch therefore supplies no empirical live-interception benefit; refusal behavior is established by the independent deterministic tests, which include injected premature completion and stale/foreign frames. The two valid but incorrect model proposals were conservative or incomplete next steps and were allowed as such.

Inspecting the recorded summaries explains the valid-response errors: Qwen's model-only summary mentioned missing mobile verification after an external edit but omitted the also-missing desktop check, and the reader requested only mobile. Gemma's model-only summary retained both passed checks but added a need to confirm before proceeding; its reader reported blocked although the host had no pending work. Qwen's other two failures were copying large portions of history into summaries of 2,725 and 4,370 bytes, over the frozen 1,800-byte limit. Thus the apparent gain combines reduced summarization burden, budget compliance and fewer semantic omissions; it is not solely a reasoning improvement.

Controlled callback replay rejected old-revision successes and older same-revision results; changing source invalidated prior checks. Switching designs kept results attached to their original document. Passed checks did not override a pending export job. Preview outcomes and object inventories are fixture-controlled, not results of real rendering or UI selection. The bound JSX edit entry point is tested separately in the scoped branch and is not invoked by this reader pilot.

## Calls, context and usage

| Model | Condition | Calls | Reported input tokens | Reported output tokens | Seconds | Mean summary bytes | Mean additional host-fact bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| codex | model-record | 12 | 13146 | 3281 | 142.9 | 1390 | 0 |
| codex | host-facts | 12 | 8353 | 1031 | 83.8 | 200 | 588 |
| qwen | model-record | 10 | 5405 | 7664 | 69.4 | 1570 | 0 |
| qwen | host-facts | 12 | 3989 | 5452 | 48.1 | 275 | 588 |
| gemma | model-record | 12 | 11351 | 12663 | 289.5 | 667 | 0 |
| gemma | host-facts | 12 | 8628 | 9898 | 223.7 | 269 | 588 |

Total actual calls: **70**; JSON parsed: **70**. Costs include compression and reading. Provider input usage may omit cache-read tokens; zero reported monetary cost is not billing evidence. Local digests/context were checked before and after each run. Codex uses prompt-only JSON and may not enforce the requested output cap; Ollama additionally uses JSON Schema.

Mean summary bytes include the two rejected oversized summaries. The model-only Qwen arm made 10 rather than 12 calls because those two readers were skipped; all six checkpoint conditions remain in its score denominator. The hybrid had lower reported tokens and call time in this sample, but caching and different compressor inputs mean these observations are not a controlled latency benchmark.

## Interpretation and limits

This is a comparison of architectures, not a token-matched prompt ablation: the hybrid supplies authoritative runtime facts in addition to a shorter model summary. Both arms use the same output protocol and gate, but generate independent summaries. Six correlated checkpoints from two agent-authored synthetic scenarios cannot establish statistical significance, held-out generalization or an improvement against v1. The host cannot discover a user's intended object or authorize a scope by itself; fixtures supply those selections. These APIs are not wired into production desktop tools.

Validation: 46 context research tests, 35 scoped research tests, focused strict TypeScript and full-checkout Biome passed. The early TypeScript check caught a readonly-array mutation in a test; it was corrected before model generation. No failed live attempts were silently rerun or normalized. Node 24.19.0 was used; Node 22 was not retested.
