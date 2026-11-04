# Four-method memory study v1

Research-only protocol `trace-state-memory-study@1`; no product memory, API,
provider, session or UI integration. The [baseline](./STATE_BASELINE_V3_RESULTS.md)
and [v3 full-prefix calibration](./READER_CALIBRATION_V3_RESULTS.md) precede
this study. Reader `trace-state-reader@3`, approved short gold, exact aliases
and all37 evidence combinations stay frozen. Readiness remains false, so
results are diagnostic and require comparison with the uncompressed control.

## Methods and shared limits

| Method | Available history | Update | Memory cap |
|---|---|---|---|
| ordinary-summary | Previous summary + new events | Original narrative prompt | 1800-byte string |
| goal-record | Previous summary + new events | Original goal-record prompt | 1800-byte string |
| stable-handoff | Previous record + new events | Durable constraints + short handoff | 1800-byte serialized record TOTAL |
| goal-recall | Original archive prefix + public goal | Deterministic selection, no compressor call | 1800-byte whole-event envelope |

All methods receive the same public goal, event prefixes and reader questions.
Questions, reference values, scoring aliases and adjudications never enter
compression or recall selection. Reader answers never feed later updates.
The model, endpoint, credential environment variables, declared model window,
4096 output reserve and60-second timeout are unchanged. No automatic retries,
response repair, truncation or raw-history fallback after summary failure.

Reading has a2048 input ceiling measured by the explicitly enabled UTF8/4
estimate. Compressors retain the existing model-window check. Both estimated
and provider-reported overflows are enforced. Wrapper usage can omit cached
input: neither exact equal-token budgets nor precise billing are claimed.

Handoff accepts exactly two nonempty string fields `stableConstraints` and
`handoff`. The complete JSON serialization, including syntax and escaping,
must fit1800 UTF8 bytes. Sections have a soft half allocation with transfer.
The prompt requests original evidence IDs/seq/authority/revision, global/local
scope, corrections, actual file state versus user intent, stale verification,
unresolved choices and immediate unfinished obligations. It changes both
instructions and organization, so effects are a compound method comparison.

Recall first retains the complete prefix if its goal/event envelope fits.
Otherwise latest USER evidence determines active design; explicit global
rules survive while other-design local events are filtered out. Ranking
prioritizes global constraints, latest user selection and corrections, then
goal overlap, decision/observation signals and recency. Corrections with their
preceding same-design decision, and tool revision receipts for the same file,
form connected atomic bundles. Whole bundles fit or are omitted; no event is
sliced. This regex heuristic is an experimental condition, not authoritative
semantic state. Its correction rule uses the nearest preceding same-design
user decision, which may be unrelated in broader conversations; quality beyond
the frozen fixtures needs further evaluation. Record scanned/selected/omitted IDs, archive access, elapsed wall time,
memory bytes/hash and original source metadata. Archive access differs from
closed-memory retention and is reported separately.

## Short matrix:112 planned calls

Four approved trajectories × four methods × one/three update schedules.
Each closed method has16 compressions and16 readers; recall has16 readers
and no model compression. Total48 compressors +64 readers. Final denominator
is9 states per method/schedule; all-stage diagnostics are9 or27. Failures and
blocked stages retain these denominators and original reasons.

Short histories fit the recall cap completely, so this phase validates wiring
and independent stochastic reader calls. Recall's schedules are retrieval
frequency, not recursive compression; final selected memory is identical for
the same prefix. Short results do not establish retrieval quality.

## Long matrix:84 planned calls

Mechanically derive version-facts and correction-new-design from approved
core events. Insert10 deterministic irrelevant TOOL diagnostics in each of
five gaps:56 events per history. Noise alternates another-design `App.jsx`
and same-design `diagnostics.json` performance logs without new core facts,
user decisions or revisions. Keep core event IDs/text unchanged; remap seq,
cutoffs and every mandatory/allowed evidence tuple, then validate references.
Annotation is `synthetic-derived-reviewed-core`, not new independent human
annotation. Heldout data are untouched.

Run3 trials per family and3 updates at mapped core e1/e3/e5. Probe only at
the final cutoff. Per family/trial:3 closed methods × (3 compressors+1 reader),
recall1 reader, full-prefix1 reader =14. Total54 compressors +30 readers.
The6 uncompressed controls have a separately logged8192 reader input ceiling;
other readers remain2048. Long preparation verifies full history exceeds the
memory cap and fits that control ceiling. This is a bounded synthetic long
history relative to the reader budget, not a model-window exhaustion test.

Report each axis, joint, format/runtime, failure and skipped counts, budgets,
archive cost, bytes, latency, and family/trial results. Three trials of two
families support descriptive counts/ranges, not significance or corpus-wide
superiority. Final-only probes cannot locate the round where information was
lost. Exact mismatches needing semantic review keep their strict grades.

## Entry and reproducibility

`state-stress-cli.ts --track memory-study --config <local.json> --output <new-dir>`
is dry by default. Config extends UnifiedConfig only with `study:short|long`;
short requires trials1, long requires trials3 and budgets[2048]. Real execution
also requires `--execute --preflight <matching-plan.json>` and a positive
call cap. Plans bind model config, method instructions, reader, data, derived
references, approval fingerprint and implementation source/lock fingerprint.
Changed source or scoring invalidates older plans. Raw journals stay immutable.

The user-started bounded host retains fixed model/security restrictions.
The interrupted first host reserved88 of300 calls. A new host may reserve at
most212; the remaining short112 +long84 reserve196, leaving16 overall.
Do not reset the aggregate cap or replay previous batches on reconnection.
