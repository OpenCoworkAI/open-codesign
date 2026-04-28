# EDITMODE protocol

Declare user-tweakable visual parameters near the top of the artifact source:

```js
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accentColor": "oklch(0.78 0.16 200)",
  "density": 1,
  "darkMode": false
}/*EDITMODE-END*/;
```

Rules:

- The marker content must be valid JSON: no comments, JS expressions, trailing commas, arrays, or nested objects.
- Values may be string, number, or boolean.
- Use camelCase keys and reference them from source through `TWEAK_DEFAULTS`.
- Pick 2-6 values that materially change the design.
- Empty `{}` is valid when no useful controls exist yet.
- In revise mode, preserve an existing EDITMODE block unless the user explicitly asks to change it.
