---
'@open-codesign/core': patch
---

perf(prompts): shrink Layer 1 by compressing workflow / pre-flight / anti-slop-digest

Compressed three Layer 1 (always-on) prompt sections to reduce token cost for small-context models (e.g. minimax-m2.5:free at 8k ctx):

- `workflow.v1.txt`: 2724 → 1556 bytes
- `pre-flight.v1.txt`: 2241 → 1434 bytes
- `anti-slop-digest.v1.txt`: 1698 → 1203 bytes

Total Layer 1 reduction: ~2.5 KB per request. All rules preserved; dropped only explanatory prose, rationale paragraphs, and framing copy. Pre-flight beats and section headings retained verbatim for retrieval & test stability.
