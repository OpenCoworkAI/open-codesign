# PR 433 bot review follow-up

- Findings from github-actions review: guard research prompt by actual tool availability; optional companion failure must not fail primary export; research_records must be read-only. Also audit fresh-config write paths for webSearch retention.
- Fix prompt using host availability plus model-visible research tools (including explicit tool overrides), with present/absent/override tests.
- Catch only optional companion preparation/write errors in normal export IPC, return researchWarnings with primary result; leave primary exporter errors and explicit research_export failures strict.
- Remove directory creation from record loading; add read-only host path using existing writer lock, preserve bytes/mtime when reading and do not create research directory/file on empty workspace.
- Audit all production writeConfig/hydrateConfig paths and their preservation tests, report exact scope; no user credentials/config inspected.
- Targeted regressions passed: core/manifest 92, export/research 44, config paths 102. Desktop/core typechecks, lint and desktop build passed. Committed 03532a4 (20 new tests).
- Initial normal push failed during broad worker startup timeouts. Package-serial rerun passed 9 packages but hit existing Windows browser flakiness (TweakPanel profile lock + two preview timeouts). No assertions/code/test timeouts changed and no hooks bypassed. Targeted preview native-select cases subsequently passed unchanged (11 cases); retrying TweakPanel standalone before normal push.
- Reply to bot and verify remote checks after successful push. Preserve PR readiness state (currently ready for review); no unrelated changes.
