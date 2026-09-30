# PR 433: merge current upstream main

- Starting local/remote feature head: 03532a4. Upstream main: 3b03e7a (#430 deterministic local React source editing).
- Use a normal merge commit, not a rewrite/force push; preserve all published review fixes and upstream local-edit/security behavior.
- Inspect runtime EDITMODE/script-literal changes carefully: upstream adds source-edit instrumentation and stronger source-aware binding. Resolve semantically, not wholesale ours/theirs.
- Keep current dependency additions (parse5/entities) and upstream dependency/lockfile changes. Do not publish local plans/logs or touch user config.
- Validate runtime/source editing, research/export/guidance and config paths; run typecheck, lint, desktop build and normal pre-push full tests. If Windows browser suites flake, diagnose without bypassing hooks.
- Completed normal merge commit 3ca7e7217ed53489f72fc470fadc8579d7710c58 (parents 03532a4 and upstream 3b03e7a). Single implementation matches upstream's first-BEGIN/first-END semantics exactly, both test suites retained.
- Validation passed: 172 runtime + 260 targeted desktop tests; full suite 3,614 package tests + 61 scripts, 4 skips; workspace types, lint, desktop build and standard pre-push hooks all passed.
- Initial Git Schannel TLS handshakes/upload failed. Per-command OpenSSL + HTTP/1.1 succeeded with certificate verification still enabled; no permanent config changes, forced push or bypassed hooks.
- Remote branch/PR head verified at 3ca7e72; PR now MERGEABLE/CLEAN. Latest CI, CodeQL (0 annotations), dependency review, Linux packaging smoke and bot review jobs passed.
- Bot reports no new Blocker/Major/Minor. One new non-blocking nit remains: clear cached consent promises on infrastructure rejection to allow retries. Not expanded into this merge-only task.
- Merge explanation posted at https://github.com/OpenCoworkAI/open-codesign/pull/433#issuecomment-5763983212.
