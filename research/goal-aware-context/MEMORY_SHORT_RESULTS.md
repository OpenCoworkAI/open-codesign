# Short four-method results — 2026-11-01

Diagnostic development study, protocol trace-state-memory-study@1, reader
trace-state-reader@3. Model Doubao-Seed-2.0-mini manually fixed by the
user in Ark; request alias ark-code-latest, backend version unknown.

Planned 112 calls; actual 100. Worker exit2,
status incomplete. Every planned probe remains in the denominator.
Output4096, memory1800 UTF8 bytes, reader input2048 estimated tokens,
timeout60s, no retries. Four approved short trajectories, 1 trial, one/three updates. Recall keeps all short events because they fit: it tests wiring, not retrieval quality.

## Final states

| Condition | Value/type | Scope | Sources | Invalidation | Joint |
|---|---:|---:|---:|---:|---:|
| ordinary-summary/1 | 1/9 | 2/9 | 0/9 | 2/9 | 0/9 |
| ordinary-summary/3 | 0/9 | 0/9 | 0/9 | 0/9 | 0/9 |
| goal-record/1 | 8/9 | 3/9 | 0/9 | 8/9 | 0/9 |
| goal-record/3 | 5/9 | 0/9 | 0/9 | 7/9 | 0/9 |
| stable-handoff/1 | 4/9 | 1/9 | 0/9 | 4/9 | 0/9 |
| stable-handoff/3 | 6/9 | 3/9 | 2/9 | 7/9 | 0/9 |
| goal-recall/1 | 8/9 | 6/9 | 8/9 | 7/9 | 5/9 |
| goal-recall/3 | 7/9 | 7/9 | 8/9 | 8/9 | 4/9 |

## Runtime and format

| Condition | Calls actual/planned | Final valid/planned | All observed statuses |
|---|---:|---:|---|
| ordinary-summary/1 | 7/8 | 1/4 | length:2, ok:1, invalid-summary:1 |
| ordinary-summary/3 | 13/24 | 0/4 | length:3, invalid-summary:2, blocked-by-prior-summary:4, ok:2, invalid-json:1 |
| goal-record/1 | 8/8 | 4/4 | ok:4 |
| goal-record/3 | 24/24 | 4/4 | ok:10, length:2 |
| stable-handoff/1 | 8/8 | 3/4 | length:1, ok:3 |
| stable-handoff/3 | 24/24 | 3/4 | length:3, ok:9 |
| goal-recall/1 | 4/4 | 4/4 | ok:4 |
| goal-recall/3 | 12/12 | 4/4 | ok:12 |


## Interpretation boundaries and audit

The four final recall request pairs (one versus three retrieval schedules)
have identical message bytes and request hashes. Their joint5/9 versus4/9
therefore reflects independent reader responses and exact wording, not a
recursive-compression effect. The paired-request audit is retained locally.

- Full-prefix v3 calibration itself had final joint6/9 and readinessfalse.
  A compressed failure alone does not establish compression-caused forgetting.
- Scope and original evidence are independently scored; matching a value
  does not establish a fully correct state. Unknown wording stays strict
  mismatch pending review. No response extraction, repair or new aliases.
- Archive recall can reread the original prefix; closed summaries cannot.
  Archive scan/selection IDs, memory bytes and elapsed wall time are logged.
  Handoff changes instructions as well as memory organization.
- All-stage denominators9/27 differ from final9. Recall schedule changes retrieval frequency; identical final prefixes give identical selected memory but independent reader calls.
- Wrapper token/cost usage may omit cache reads. Estimates are not exact
  equal-token comparisons or verified billing. Truncated call usage/status
  is retained; partial text is unavailable through the pi length-error boundary.
- Reader failureCause can be null; status and call journals preserve the reason.
  Selector correction bundling is heuristic; broader quality remains unproven.

Offline audit reproduced every score, verified 44 compressor inputs,
56 reader inputs and 16 recall updates, plus
100 recorded request intents. Previous memory and delta match their
own chain; probe answers never feed later compression. All five raw files
have SHA-256 records; score changes0.

Local ignored evidence: goal-20261101/memory-short-live-001 and
analyses/memory-short-001/analysis.json. Plan hash:
e198d3c53597059bc8150e2e55ef3f68a796e05c290450a6674eb4f3cba5e107. 15 distinct strict value mismatches are saved
with raw evidence for possible human review, without changing these scores.
