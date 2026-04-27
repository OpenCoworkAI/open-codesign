# Vision and Principles v2 Update Plan

## Goal

Update `docs/VISION.md` and `docs/PRINCIPLES.md` so they reflect the latest v0.2 direction rather than the earlier Claude Design reproduction framing.

## Source Order

1. `docs/v0.2-plan.md` as the main source for the latest plan.
2. `docs/V0.2_ROADMAP.md` and `docs/plans/2026-04-23-v0.2-agentic-design-loop-design.md` for supporting context if needed.
3. Existing `docs/VISION.md` and `docs/PRINCIPLES.md` for stable constraints that should remain.

## Steps

1. Read v0.2 plan and supporting roadmap/design docs. - complete
2. Extract the product direction changes that belong in Vision. - complete
3. Extract engineering principle changes that belong in Principles. - complete
4. Edit both docs in place, preserving useful existing structure. - complete
5. Run lightweight Markdown/diff validation. - complete

## Notes

- Preserve hard constraints unless v0.2 plan clearly supersedes them.
- Keep docs direct and public-maintainer friendly.
- Avoid adding implementation plans to Vision; keep detailed work sequencing in roadmap/plan docs.

## Findings

- `docs/v0.2-plan.md` supersedes the older v0.2 agentic design doc because it was updated after the pi-coding-agent spike.
- The latest plan moves storage from SQLite to pi JSONL sessions plus real workspace files.
- The latest plan treats each design as a pi session, not a project entity.
- The latest plan says every design has a workspace; sealed/open mode is removed.
- `pi-coding-agent` now owns session, built-in tools, bash, model capabilities, provider registration, and events.
- Open CoDesign owns design-specific tools: ask, scaffold, skill, preview, gen_image, tweaks, todos, done.
- `DESIGN.md` is now both design-system input and generated artifact, using Google's spec.
- Built-in skills, scaffolds, and brand refs need progressive disclosure and license/source metadata.
- Repo license is MIT, so `docs/VISION.md` should not keep the older Apache-2.0 row.
- Validation: checked stale phrases (`Apache-2.0`, `shared SQLite`, old Claude Design demo framing, `§6b`), confirmed `docs/CONFIG.md` exists, and ran `git diff --check`.
