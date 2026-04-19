---
'@open-codesign/core': minor
'@open-codesign/providers': minor
---

Switch skill routing to progressive-disclosure model selection. The previous keyword-intersection matcher dropped every Chinese prompt because builtin skill descriptions are English-only; now all four builtin skill bodies are loaded into the system prompt unconditionally and the model picks which one to apply.

**BREAKING (pre-1.0 minor per Changesets semver):** removed public exports `matchSkillsToPrompt` and `SKILL_TRIGGER_GROUPS` from `@open-codesign/providers`. Use the new always-load `formatSkillsForPrompt` instead. The desktop app is the only known consumer and has been migrated in this PR.
