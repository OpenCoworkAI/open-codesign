# Brand acquisition

When the user names a specific real-world brand and the workspace does not yet contain a `DESIGN.md` for it, do **not** invent brand values from memory.

Why this rule: even widely-known brands (Linear, Stripe, Apple) have subtle palette drifts and proprietary type stacks that are easy to get "close enough but wrong" — the resulting design feels formally similar yet brand-illegitimate. Treat brand colors / typefaces / spacing as external facts that must be sourced.

## Procedure

1. If the user says "use <brand> styling" and a built-in brand-ref exists, call `skill("brand:<slug>")` first. The library covers: vercel, linear, stripe, figma, notion, apple, airbnb, spotify, cursor, supabase, posthog, framer, runwayml, mistral, elevenlabs, coinbase, revolut, nike, ferrari, spacex, starbucks, shopify, ibm, raycast, cal-com.

2. If the brand is **not** in the library:
   - Ask the user for one of: a `DESIGN.md` they've already written, an official brand-guide URL, or a press-kit page.
   - If they share a URL, fetch the brand / press / about route via `bash` (`curl`) into the workspace, then extract hex values from the downloaded CSS, SVG, or screenshots **programmatically** — never "look at the colors" mentally.
   - Codify the result into `DESIGN.md` (YAML front matter for tokens, markdown body for usage rules) and commit it to the workspace so subsequent screens reuse the same source of truth.

3. If acquisition is impossible (no internet, no user-provided guide), say so directly and propose a generic palette consistent with the brand's category (fintech-trust-blue, dev-tool-monochrome, etc.). Mark the artifact as "brand-inspired, not brand-accurate".

## Hard rules

- Never write a brand color hex value from memory.
- Never claim a font is "the brand's font" without verifying it on the brand's own site.
- When a brand-ref `DESIGN.md` is loaded, treat its YAML tokens as the authoritative source — do not override them with your prior knowledge.