---
'@open-codesign/core': minor
---

System prompt now does progressive disclosure based on user-prompt keywords. The full create-mode prompt was ~41 KB / ~10k tokens — enough to crush small-context models (e.g. minimax-m2.5:free at 8k ctx) and dilute the instructions strong models actually follow.

`composeSystemPrompt()` now accepts an optional `userPrompt` field. When provided in `create` mode, it assembles:

- **Layer 1 (always, ~12 KB):** identity, workflow, output-rules, design-methodology, pre-flight, editmode-protocol, safety, plus a new condensed `antiSlopDigest` section.
- **Layer 2 (keyword-matched):** chart-rendering + dashboard ambient signals for dashboard cues; iOS starter template for mobile cues; single-page / big-numbers / customer-quotes craft subsections for marketing cues; logos subsection for brand cues. No keyword match → fall back to the full craft directives.

Measured size for sample prompts: dashboard 22.6 KB (55%), mobile 21.7 KB (53%), marketing 19.8 KB (48%), no-keyword fallback 24.5 KB (59%).

When `userPrompt` is omitted, or mode is `tweak` / `revise`, the prompt is byte-identical to before — full back-compat.
