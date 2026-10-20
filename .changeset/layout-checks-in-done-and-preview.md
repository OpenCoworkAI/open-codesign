---
"@open-codesign/core": patch
"@open-codesign/desktop": patch
---

Check layout and accessibility in `preview` and `done`. After a page loads, a deterministic measurement looks for a page that scrolls sideways, text that its box clips, text with too little contrast (WCAG AA, 4.5:1, or 3:1 for large text), tap targets under 24 by 24 px that have another target next to them, and controls with no accessible name. It measures at the current width and again at a 390 px phone width. `preview` lists up to 20 findings in `layoutIssues`; `done` shows them under "Non-blocking warnings", and when one is present it lets the agent fix it and check it with `preview` instead of telling it to stop. Findings never change `ok` or the `done` status, so a false positive cannot cost a repair round. `done:verify:v1` now returns `warnings` and a `schemaVersion` next to `errors`.
