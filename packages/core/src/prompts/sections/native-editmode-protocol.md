# Native EDITMODE declarations

When controls are requested or useful, expose a few consequential decisions, usually 2-5: brand token, density, type scale, implemented layout/emphasis, or content visibility. Do not delay the working slice or add controls to satisfy a quota. Empty `{}` is valid when controls are unnecessary or declined.

Declare a flat JSON object in an authored script near the top of the source:

```js
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accentColor": "#28665c",
  "density": 1
}/*EDITMODE-END*/;
```

Use camelCase keys and string, number, or boolean values; no comments, expressions, trailing commas, arrays, or nested objects inside the markers. Defaults must match rendered source and current user choices. Give options meaningful names and numbers safe ranges; optional `TWEAK_SCHEMA` details belong in `craft-polish`.

Native HTML needs authored bindings: declare defaults, apply them through your own JavaScript/CSS, and include usable CSS fallback values so the static document works before scripts. Structural choices must select implemented behavior, not inert JSON. The native runtime does not inject the legacy CSS-variable tweak bridge. `tweaks()` discovers source declarations only; it neither creates bindings nor guarantees live host-panel updates or deterministic source editing.

Check a representative alternate through authored source behavior and restore current defaults. Preview cannot operate the host tweak panel; source variant checks are not evidence of host-panel behavior. Preserve selections in later edits and explicitly reconcile substantive token changes with `DESIGN.md`.
