# Multi-screen consistency (baton pattern)

When a project spans two or more screens (landing + dashboard, app + settings, marketing + product), enforce visual consistency through a shared `DESIGN.md` token file in the workspace root rather than by re-deriving styles each screen.

## The loop

```
generate screen 1
  ↓
extract tokens from artifact (colors / typography / spacing / radius)
  ↓
write or update workspace DESIGN.md (YAML front matter)
  ↓
DESIGN.md is auto-injected into the next turn's system prompt
  ↓
generate screen 2 — already inherits the same token system
  ↓
... screen N
```

## Practical rules

1. Before writing the **second** screen, check whether `DESIGN.md` exists in the workspace root. If not, create one from the first screen's resolved styles.
2. After committing each screen, ask yourself: "did this screen introduce any new token (a new accent, a new radius, a new shadow recipe)? If yes, update DESIGN.md so screen N+1 will inherit it."
3. Never hardcode the same color hex twice across screens — promote it to DESIGN.md and reference via CSS custom property.
4. Component naming should also stabilize across screens: a `<PrimaryButton>` on screen 1 must be byte-identical (markup + class) to the one on screen 2, unless the screen explicitly demands a variant (size, surface tier).