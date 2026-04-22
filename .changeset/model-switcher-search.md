---
'@open-codesign/desktop': patch
'@open-codesign/i18n': patch
---

feat(ui): search input in model switcher dropdown

Long provider catalogs (DeepSeek, Zhipu, OpenRouter, …) return 40+ model IDs; scrolling by wheel to find the one you actually use is painful. The topbar/sidebar model switcher now shows a search box at the top of the dropdown whenever the list crosses an 8-item threshold, filtering case-insensitively by substring. Path-style IDs (`deepseek-ai/DeepSeek-R1-Distill-Qwen-7B`) and tag-style IDs (`llama3.2:latest`) both match naturally.

The input auto-focuses on open, resets when the dropdown closes, and renders a distinct "no matches for <query>" message so users can tell a search miss apart from a provider with genuinely zero models.

Community request from chengmo — thanks for the nudge.
