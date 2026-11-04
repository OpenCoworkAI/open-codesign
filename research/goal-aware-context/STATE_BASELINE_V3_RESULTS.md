# Minimal pressure baseline — 2026-11-01

Diagnostic development run, reader `trace-state-reader@3`, unchanged approved
references and original ordinary-summary/goal-record compressor prompts.
Doubao-Seed-2.0-mini was manually fixed in Ark by the user; request alias
`ark-code-latest`, backend version unknown. Output4096, memory1800 UTF8
bytes, reader input2048 estimated tokens, timeout60s, no automatic retries.

The frozen plan allowed64 calls (32 compression,32 reading). Actual57
(30 compression,27 reading). All32 planned stage observations remain:
22 ok,5 length,3 invalid-summary,2 blocked-by-prior-summary. The worker
finished normally with exit2/status incomplete; this denotes observed
runtime/format failures, not an unobserved or restarted experiment.

| Final condition | Value/type | Scope | Sources | Invalidation | Joint |
|---|---:|---:|---:|---:|---:|
| Ordinary,1 compression | 2/9 | 2/9 | 0/9 | 1/9 | 0/9 |
| Ordinary,3 compressions | 4/9 | 1/9 | 0/9 | 4/9 | 0/9 |
| Goal record,1 compression | 5/9 | 2/9 | 0/9 | 5/9 | 0/9 |
| Goal record,3 compressions | 5/9 | 1/9 | 0/9 | 6/9 | 0/9 |

The all-stage diagnostic denominators are9 for one compression and27 for
three. They are not interchangeable final-condition sample sizes.

The dominant strict limitation is missing original evidence IDs/seq/roles
and exact scope after summarization. Value retention alone does not establish
a usable traceable state. Some compressions add unrequested top-level fields
(`revision`, `remaining_work`, or another field); these remain invalid even
when the summary string fits. Five reader calls hit the output limit.
No output was repaired, retried, removed from the denominator or rescored
with new aliases.

Full-prefix v3 calibration was itself imperfect: final joint6/9, value8/9,
scope7/9, sources8/9 and invalidation8/9. Therefore failed compressed answers
cannot all be attributed to compression. Four tiny synthetic trajectories
and one trial do not establish superiority or reliable round effects.
Original compressor prompts do not explicitly demand provenance tuples;
the planned handoff prompt changes that instruction as well as organization.
Treat the follow-on comparison as a compound method intervention.

Offline replay reproduced every score. A separate audit checked every
compression's previous-summary/delta input against the frozen plan, every
reader's matching frozen summary, unique call IDs and57 recorded pre-call
intents. Probe answers never entered later compression. Five raw files were
SHA-256 recorded; raw files and historical reports remain unchanged.

Evidence: ignored `goal-20261101/stress-baseline-v3-live-001` and
`analyses/stress-baseline-v3-001/{analysis,isolation-and-runtime}.json`.
Plan hash `c4296155639caa31360a88328c66e8f67fb77eb1cb88f226d2e871b9917391f7`.
Wrapper-reported usage may omit cached input and is not exact token or
billing accounting. No provider errors or retries were recorded.
