## Follow-up to the bot review — 03532a4

Addressed the three findings in [the bot review](https://github.com/OpenCoworkAI/open-codesign/pull/433#pullrequestreview-5262408997):

1. **Research guidance without tools:** the workflow block is now included only when a research host exists and the full research tool set survives the final model-visible tool selection. Explicit `deps.tools` overrides that remove research tools also omit the instructions. Added absent-host and overridden-tool tests alongside the existing positive registration/guidance test.
2. **Optional companions blocking primary exports:** normal export IPC catches companion preparation and companion-file write failures and returns `researchWarnings` with the successfully saved primary result. It never claims a `sourcesPath` for a file not written. Primary exporter failures remain errors, and explicit `research_export` still fails if source generation fails. Added IPC regressions for corrupt records across HTML/PDF/PPTX/ZIP/Markdown, incompatible slide snapshots, missing renderer, unwritable companion, successful sidecar/ZIP output, and genuine primary-export failure.
3. **Read operations rewriting research metadata:** `research_records` now uses a read-only path under the existing workspace writer lock. Record loading does not create `.codesign` either. Added checks for absent directory/file, exact byte and modification-time preservation, and retaining corrupted metadata unchanged.

### Configuration audit answer

Audited all **17 production fresh `Config` constructions**: provider CRUD/model selection (6), external imports (4), Codex OAuth paths (4), image settings (1), design-system save (1), and onboarding reset (1). Each preserves `webSearch` when present. The additional boot migration write retains the original config via spread; final `toPersistedV3` serialization preserves the field as well. No additional dropping path was found. Existing enabled/disabled/absent and custom-limit save/round-trip tests were rerun; onboarding reset still intentionally clears credentials rather than silently inventing a key.

### Validation

VALIDATION_RESULTS

No new dependency or UI panel was added in this follow-up. The PR's current readiness state is unchanged.
