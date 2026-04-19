---
'@open-codesign/core': patch
---

Align system prompt content with Claude Design conventions extracted from real artifact analysis (research docs §11.4, §1.2, §2, §6, §11.3):

- EDITMODE protocol: empty `{}` block is now valid — signals tweak-aware artifacts to the host.
- Design methodology: token-density target 9 ± 3 oklch tokens per artifact.
- Craft directives: typography ladder defaults to two font families (mono only when needed); add four-animation CSS keyframe budget (`fadeUp` / `breathe` / `pulse-ring` / `spin`).
- Progressive disclosure: marketing/landing/case-study prompts now surface a Fraunces typography hint as a Layer 2 routing addition.
