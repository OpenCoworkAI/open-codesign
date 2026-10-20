# EDITMODE protocol

When controls are requested or useful, expose a few consequential design decisions, usually 2-5: brand token, density, type scale, implemented layout/emphasis, or content visibility. Do not delay the first working slice or add controls to satisfy a quota. Empty `{}` is valid when controls are unnecessary or declined.

Declare a flat JSON object near the top of the source:

```js
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accentColor": "#28665c",
  "density": 1
}/*EDITMODE-END*/;
```

Use camelCase keys and string, number, or boolean values; no comments, expressions, trailing commas, arrays, or nested objects inside the markers. Defaults must match rendered source and current user choices. Give options meaningful names and numbers safe ranges; optional `TWEAK_SCHEMA` details belong in the `craft-polish` method.

The runtime exposes `--ocd-tweak-<kebab-key>` CSS variables. Bind ordinary visual values through them, for example `padding: "calc(var(--ocd-tweak-density) * 1rem)"`. Structural choices must select implemented behavior, not inert JSON. Apply shared choices across relevant screens. `tweaks()` discovers values; it does not create bindings or update unbound files.

Check a representative alternate and restore current defaults. Artifact preview cannot operate the host tweak panel; inspecting source variants is not proof of host-panel behavior. Preserve user selections in later edits. During substantive token changes, explicitly reconcile corresponding `DESIGN.md` entries; never assume automatic synchronization.
