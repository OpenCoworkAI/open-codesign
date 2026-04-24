# EDITMODE protocol — declaring tweakable parameters

When your artifact has user-tweakable visual parameters (accent colors, density toggles, layout variants), declare them at the top of your code as a JSON block bracketed by magic comments:

```js
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accentColor": "oklch(0.78 0.16 200)",
  "headerStyle": "minimal",
  "showSubtitles": true,
  "spacingScale": 1.0
}/*EDITMODE-END*/;
```

The host environment will:
1. Scan your source for the `/*EDITMODE-BEGIN*/.../*EDITMODE-END*/` markers
2. JSON.parse the content between them
3. Render type-appropriate controls (color picker for color strings, toggle for booleans, slider for numbers, select for enum strings)
4. On user change, string-replace just that block in the source — no LLM call needed

## Rules

- The block must be valid JSON. No comments inside, no JS expressions, no trailing commas.
- Keys are camelCase identifiers.
- Values must be strings, booleans, or numbers (no arrays/objects in v1).
- Place the block early in the document so it's easy to find.
- Reference the parameters from your code via the named constant (`TWEAK_DEFAULTS.accentColor`).
- Pick 3-6 parameters that meaningfully change the artifact's look. Don't expose every CSS variable.

## Empty block is valid

Even if your artifact has no tunable parameters yet, you may emit an empty block — it signals to the host that this artifact is tweak-aware:

```js
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{}/*EDITMODE-END*/;
```

The host scans for the markers regardless of contents.

## Type detection

| Value pattern                                | Renders as       |
|----------------------------------------------|------------------|
| `"oklch(...)" / "rgb(...)" / "#hex"`         | Color picker     |
| `true / false`                               | Toggle switch    |
| Number (e.g. `1.0`, `16`, `0.5`)             | Slider           |
| Plain string                                 | Text input       |

## When to use

Always for artifacts with theming options. Examples:
- Dashboard with adjustable accent palette
- Mobile mock with light/dark toggle
- Landing page with density variants

## When NOT to use

- Trivial one-off artifacts with no parameters
- When parameters affect content semantics (use a follow-up generation, not Tweaks)

## Behavior in revise mode

In revise mode (when an existing artifact is being edited):
- If the existing artifact ALREADY has a `/*EDITMODE-BEGIN*/.../*EDITMODE-END*/` block: PRESERVE it as-is (don't remove or rewrite the values).
- If the existing artifact has NO EDITMODE block: do NOT add one unless the user explicitly asks for tweakable parameters.
