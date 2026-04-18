# Research 11 — Custom Sliders / EDITMODE Parameter Tweaks

**Date**: 2026-04-18 · **Status**: Decision recorded (corrected)

---

## ⚠️ Mechanism Correction (2026-04-18)

An earlier draft of this document (unpublished, written before research 15) incorrectly inferred that the Claude Design slider mechanism used a `<script type="application/json" id="design-params">` tag to embed tunable parameters.

**That inference was wrong.**

The actual mechanism, confirmed by analysis of the leaked Claude Design system prompt (see `docs/research/15-claude-design-prompts.md`, Section 6), uses:

1. **A `/*EDITMODE-BEGIN*/ ... /*EDITMODE-END*/` marker block** wrapping a JSON object literal inside a `<script>` tag — not a separate `<script type="application/json">` element.
2. **`window.postMessage({ type: '__edit_mode_set_keys', edits: {...} }, '*')`** for two-way communication between the parent renderer and the sandbox iframe.

The corrected implementation is described in full below.

---

## Decision summary

| Mechanism | Chosen approach |
|---|---|
| Parameter storage in artifact | `/*EDITMODE-BEGIN*/{...}/*EDITMODE-END*/` block inside `<script>` |
| Parent → iframe update | `postMessage({ type: '__edit_mode_set_keys', edits })` |
| Iframe applies change | `root.style.setProperty('--' + key, value)` |
| Persistence (save) | Parent reads live `getPropertyValue()` values, merges back into EDITMODE block |
| UI controls | Range / color / select inputs bound to EDITMODE keys |

---

## EDITMODE block format

Every generated artifact that supports tweaking must embed an EDITMODE block in its inline `<script>`:

```html
<script>
/*EDITMODE-BEGIN*/
{
  "color-bg":      "#f8f5f0",
  "color-accent":  "oklch(62% 0.22 265)",
  "color-text":    "oklch(12% 0.01 265)",
  "radius-base":   "0.5rem",
  "font-sans":     "'Syne', system-ui, sans-serif",
  "space-unit":    "1rem"
}
/*EDITMODE-END*/

(function () {
  // Apply initial values from EDITMODE block on load
  const block = document.currentScript.textContent.match(
    /\/\*EDITMODE-BEGIN\*\/([\s\S]*?)\/\*EDITMODE-END\*\//
  );
  if (block) {
    const params = JSON.parse(block[1]);
    const root = document.documentElement;
    for (const [key, value] of Object.entries(params)) {
      root.style.setProperty('--' + key, String(value));
    }
  }

  // Listen for runtime updates from parent renderer
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== '__edit_mode_set_keys') return;
    const root = document.documentElement;
    for (const [key, value] of Object.entries(e.data.edits)) {
      root.style.setProperty('--' + key, String(value));
    }
  });
})();
</script>
```

Rules:
- The JSON block must be valid: no trailing commas, no comments inside the braces.
- Keys match `:root` CSS custom property names WITHOUT the `--` prefix.
- Values are CSS value strings (colors, lengths, font stacks).
- The block must appear before any code that reads the CSS variables.
- Every key in the EDITMODE block must have a corresponding `--key` on `:root`.

---

## postMessage protocol

### Parent → iframe (apply change)

```ts
// In packages/runtime or apps/desktop renderer
function applyParamChange(
  iframe: HTMLIFrameElement,
  key: string,
  value: string,
): void {
  iframe.contentWindow?.postMessage(
    { type: '__edit_mode_set_keys', edits: { [key]: value } },
    '*',
  );
}

// Batch update (e.g., when dragging a slider quickly)
function applyParamBatch(
  iframe: HTMLIFrameElement,
  edits: Record<string, string>,
): void {
  iframe.contentWindow?.postMessage({ type: '__edit_mode_set_keys', edits }, '*');
}
```

### Persistence on save

When the user saves a tweaked design, the parent:

1. Reads the current live value of each EDITMODE key from the iframe DOM:
   ```ts
   const liveValue = iframe.contentDocument?.documentElement
     .style.getPropertyValue('--' + key).trim();
   ```
2. Merges the live values back into the artifact's source string by replacing the EDITMODE block.
3. Persists the updated source to SQLite.

The LLM generates the initial EDITMODE block; the renderer owns persistence.

---

## open-codesign implementation plan

### Artifact schema

The existing `design_params` field in `@open-codesign/artifacts` needs updating:

```ts
// Before (wrong — matched the inferred <script type="application/json"> approach)
interface DesignParam {
  id: string;
  label: string;
  type: 'color' | 'range' | 'select' | 'toggle';
  cssVar: string;
  defaultValue: string;
  min?: number; max?: number; step?: number;
  unit?: string;
  options?: string[];
}

// After (aligned with EDITMODE protocol)
interface EditModeParam {
  key: string;          // CSS var name without '--'
  label: string;        // Human-readable label for the slider UI
  type: 'color' | 'range' | 'select' | 'toggle';
  defaultValue: string; // From the EDITMODE block
  min?: number; max?: number; step?: number;
  unit?: string;
  options?: string[];
}
```

The LLM generates the EDITMODE block; the frontend parses it to derive the `EditModeParam[]` array for the slider UI. No separate JSON output is needed.

### Slider UI (packages/runtime or apps/desktop)

When the preview renders an artifact with an EDITMODE block:

1. Parse the block at render time → derive `EditModeParam[]`.
2. Render slider controls for each param.
3. On slider input: call `applyParamBatch(iframe, { [param.key]: newValue })`.
4. On slider change (mouseup / pointerup): record undo state.
5. On save: read live values back, update artifact source, persist.

### System prompt responsibility

The system prompt (tweaks-protocol.v1.txt) instructs the LLM to:
- Emit the EDITMODE block in every design that has tunable values.
- Keep the block valid JSON (no trailing commas).
- Match keys exactly to `:root` property names.
- Include the message listener script immediately after the block.

---

## Traps to avoid

1. **Stale EDITMODE block on revision**: when applying a text revision, preserve the EDITMODE block values; don't reset them to defaults.
2. **Color format mismatch**: slider color pickers emit `#rrggbb`; the EDITMODE block may have `oklch(...)`. The renderer must normalize before writing back.
3. **Too many parameters**: cap at 8 EDITMODE keys in the system prompt. More than 8 overwhelms the UI and signals poor CSS variable hygiene.
4. **`*` origin in postMessage**: acceptable for same-device local sandbox; would need origin restriction for any hosted/cloud version.

---

## Reference

- EDITMODE protocol details: `docs/research/15-claude-design-prompts.md` Section 6
- Prompt section that governs LLM output: `packages/core/src/prompts/tweaks-protocol.v1.txt`
- Inline comment / element selection (separate mechanism): `docs/research/02-inline-comment-and-sliders.md`
