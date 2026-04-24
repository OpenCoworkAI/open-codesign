---
schemaVersion: 1
name: surface-elevation
description: >
  Builds a coherent 4-tier surface system (base, raised, overlay, scrim)
  using lightness deltas and layered shadows instead of one big drop
  shadow. Replaces the older "glassmorphism" mental model — see body for
  alias note. Use when designing cards, modals, popovers, dropdowns,
  command palettes, or any layered UI.
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

> Alias note: this skill supersedes the older "glassmorphism" guidance. If
> you were looking for blur/frost rules, see the Glass effect rule below —
> it lives inside the broader elevation system.

## When to use

Trigger this skill when:

- Designing or coding cards, panels, modals, popovers, tooltips, dropdowns, command palettes, drawers.
- Stacking multiple surfaces (modal over card over page).
- Choosing shadows, blurs, or border treatments for elevated UI.
- Auditing a UI that "feels flat" or "feels like floating stickers".

## Rules

1. **4-tier surface system.** Every surface belongs to exactly one tier:
   - **base** — page background, never elevated.
   - **raised** — cards, panels, sticky headers.
   - **overlay** — modals, popovers, dropdowns, command palettes.
   - **scrim** — translucent layer behind a modal that dims the content under it.
2. **Separate tiers by lightness, not by a single big shadow.** Shadow alone reads as "fake 3D"; lightness reads as "actually layered".
   - Light mode: each higher tier *loses* 4–6% L (CIELAB) — surfaces get slightly darker as they approach the viewer? No — get *lighter* visually by raising L of the surface relative to the page. In light mode the page is near-white; raised surfaces are pure white plus a hairline border. Apply tonal shift via a subtle warm/cool tint per tier (≤ 6% L delta).
   - Dark mode: each higher tier gains 5–8% L (CIELAB). A `#0b0b0c` page → `#17181a` raised → `#202225` overlay.
3. **Layered shadow (minimum 2 layers).** Use one ambient shadow (large blur, low opacity, no offset) for the soft halo + one direct shadow (small offset, sharper, slightly higher opacity) for the contact edge. Single-layer shadows look amateurish.
4. **Nested radius rule.** A child surface's `border-radius` must be ≤ its parent's. A child with bigger radius than its parent reads as a sticker glued on top.
5. **Glass effect (`backdrop-filter: blur()`) only on overlay tier.** Never on base. Always pair with a thin `1 px` translucent border (`rgba(255,255,255,0.08)` dark / `rgba(0,0,0,0.06)` light) so the glass has a defined edge.
6. **Specular highlight on raised+ surfaces.** A `1 px` `inset` white-alpha line at the top sells the elevation cheaply. Skip on base.

## Do / Don't

**Do**
- Define elevation as a token set (`--surface-base`, `--surface-raised`, `--surface-overlay`, `--scrim`) plus matching `--shadow-raised`, `--shadow-overlay`.
- Compose two-layer shadows in a single `box-shadow` declaration.
- Add the inset specular highlight to every elevated surface in dark mode.
- Use `backdrop-filter: blur(20px) saturate(1.4)` only on overlays placed above visually busy content.

**Don't**
- Don't apply `backdrop-filter` to base or page-level surfaces — it costs paint performance and adds nothing.
- Don't use a single huge `box-shadow: 0 30px 60px rgba(0,0,0,0.4)` — it looks like 2010 Material.
- Don't give a child element a larger radius than its parent.
- Don't try to elevate by darkening text instead of lifting the surface.

## Code patterns

Token set (CSS variables):

```css
:root {
  --surface-base:    #f7f7f8;
  --surface-raised:  #ffffff;
  --surface-overlay: #ffffff;
  --scrim:           rgba(15, 15, 20, 0.55);

  --shadow-raised:
    0 1px 2px rgba(15, 23, 42, 0.06),
    0 8px 24px rgba(15, 23, 42, 0.08);
  --shadow-overlay:
    0 2px 4px rgba(15, 23, 42, 0.08),
    0 24px 48px rgba(15, 23, 42, 0.18);
}

[data-theme='dark'] {
  --surface-base:    #0b0b0c;
  --surface-raised:  #17181a;
  --surface-overlay: #202225;
  --scrim:           rgba(0, 0, 0, 0.6);

  --shadow-raised:
    0 1px 2px rgba(0, 0, 0, 0.5),
    0 8px 24px rgba(0, 0, 0, 0.4);
  --shadow-overlay:
    0 2px 4px rgba(0, 0, 0, 0.55),
    0 24px 48px rgba(0, 0, 0, 0.55);
}
```

Raised card with specular highlight:

```css
.card {
  background: var(--surface-raised);
  border-radius: 12px;
  box-shadow:
    var(--shadow-raised),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
```

Overlay with glass + edge:

```css
.popover {
  background: color-mix(in oklab, var(--surface-overlay) 80%, transparent);
  backdrop-filter: blur(20px) saturate(1.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px; /* parent card was 12px → child ≤ parent */
  box-shadow: var(--shadow-overlay);
}
```
