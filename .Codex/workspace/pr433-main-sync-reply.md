## Upstream synchronization — 3ca7e72

Merged current upstream `main` (`3b03e7a`, #430 deterministic local React source editing) into the existing feature branch with a normal merge commit; no published history was rewritten.

The only conflict was runtime EDITMODE binding. The shared helper now uses upstream's exact first-BEGIN/first-END linear matching semantics, while retaining both the upstream compatibility/adversarial suite and this PR's regression suite. Source-edit instrumentation, overlay support, script-literal escaping, and the previous research/security/bot fixes are preserved. The merged manifest/lockfile retain both upstream's `@babel/parser` and the lazy `parse5` dependency.

Targeted validation passed: 172 runtime tests and 260 source-edit/research/export/generation tests, plus workspace typechecks. Full-check results: 3,614 package tests plus 61 script tests passed, 4 skipped; workspace typechecks, lint, desktop build and normal pre-push hooks passed.

The earlier bot review's three items remain addressed (tool-gated guidance, non-fatal optional export companions, read-only records). The configuration audit covered all 17 fresh Config constructions, boot migration and canonical serialization; no additional webSearch-dropping path was found.

The remote branch and PR head match local commit `3ca7e7217ed53489f72fc470fadc8579d7710c58`. GitHub now reports `MERGEABLE` (the conflict is cleared). Fresh CI, CodeQL, packaging and bot-review checks have started; their current results are available in the Checks tab.
