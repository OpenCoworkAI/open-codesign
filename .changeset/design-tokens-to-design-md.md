---
"@open-codesign/core": patch
"@open-codesign/shared": patch
---

Prepare the design-token import. Core exports `mapTokensToDesignFields`, which turns scanned tokens into DESIGN.md colors, typography, rounded and spacing fields, with font sizes, line heights and shadows as Markdown sections. It converts `rgb()`, `hsl()` and `oklch()` colors to sRGB hex (a clamped out-of-gamut color is reported with its original value), replaces `var()` with the scanned token it names, leaves other `[data-theme]` values out, and returns what it could not map instead of logging it. Shared exports `serializeDesignMd`. Tailwind v4 `--font-*` variables are now read as font families, and a CSS variable declared in a `[data-theme]` block records that block.
