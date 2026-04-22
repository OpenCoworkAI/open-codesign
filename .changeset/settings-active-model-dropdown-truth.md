---
'@open-codesign/desktop': patch
'@open-codesign/i18n': patch
---

fix(renderer): Settings active-provider card no longer misrepresents the current model

When the `/models` endpoint returns a partial list (or one that does not include the currently-active model id — common with custom gateways, manually-edited TOML, or provider-specific aliasing), the native `<select>` fell back to rendering `options[0]`. The card then visually claimed the active model was whatever happened to sit at the top of the fetched list, while the top-bar `ModelSwitcher` and the actual generation request still used the real active id (see issue #136).

Now when `config.modelPrimary` is not in the fetched list, the active id is pinned at the top of the dropdown with an `(active, not in provider list)` hint. The select always matches reality, and users can see at a glance that their configured model is not one the provider advertised — a useful signal when debugging 4xx errors (related: #124, #134).
