---
'@open-codesign/core': minor
'@open-codesign/providers': minor
---

Switch skill routing to progressive-disclosure model selection. The previous keyword-intersection matcher dropped every Chinese prompt because builtin skill descriptions are English-only; now all four builtin skill bodies are loaded into the system prompt unconditionally and the model picks. Removes `matchSkillsToPrompt` / `SKILL_TRIGGER_GROUPS`; adds `formatSkillsForPrompt`.
