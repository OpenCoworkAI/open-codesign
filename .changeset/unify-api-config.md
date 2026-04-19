---
'@open-codesign/desktop': minor
'@open-codesign/shared': minor
---

refactor(desktop): unify API config IPC + drop the separate "fast" model slot

Two threads of cleanup, shipped together because they both reshape the API config surface area.

## 1. Canonical IPC for adding/updating a provider

The 3 surfaces that touch API config (top-bar pill, Settings → API 服务, onboarding) used to call 3 different IPC handlers with 3 different return shapes. The Settings `add-provider` path returned `ProviderRow[]` and never updated the Zustand store, so the top-bar pill could lag behind reality until a manual reload.

- New canonical handler `config:v1:set-provider-and-models` accepts `{ provider, apiKey, modelPrimary, baseUrl?, setAsActive }` and atomically writes config + returns full `OnboardingState`.
- Existing `onboarding:save-key`, `settings:v1:add-provider`, `settings:v1:set-active-provider` are now thin delegates of the new handler — back-compat preserved.
- Settings → AddProviderModal and the post-add Zustand sync now both go through the new handler. `handleAddSave` re-pulls `OnboardingState` so the top-bar pill reflects the new active provider immediately.
- Preload bridge: new `window.codesign.config.setProviderAndModels()`.

## 2. Drop the separate `modelFast` model slot

The `modelFast` field was used in exactly one place (`applyComment` fallback), and its value was indistinguishable from `modelPrimary` for users — which is why every Settings UI showed two near-identical dropdowns and confused everyone.

- `Config.modelFast` is dropped from the v2 schema. v1 configs are accepted (Zod treats `modelFast` as optional and the new handler never writes it back).
- `OnboardingState.modelFast` removed; `ProviderShortlist.fast` / `defaultFast` removed.
- `applyComment` now falls back to `modelPrimary` instead of `modelFast`.
- All AddProviderModal / ChooseModel / ModelsTab UI drops the second dropdown.

Schema bump: `Config.version: 1 → 2`. Migration is read-only (drop the dead field on next write); no data loss.
