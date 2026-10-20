# Open CoDesign Built-In Resources

This directory is copied into the user's app data as an editable templates tree.
Treat every file here as shippable product surface.

## Resource Types

- `skills/*.md` are markdown method skills loaded with `skill(name)`. They
  describe how to work: layout, accessibility, charts, forms, responsive
  behavior, craft checks, and `DESIGN.md` baton rules.
- `brand-refs/*/DESIGN.md` are reference-only brand design systems loaded with
  `skill("brand:<slug>")`. They are not project files. When a brand is adopted,
  translate the relevant choices into the workspace `DESIGN.md`.
- `scaffolds/**` are concrete starter/source assets copied with
  `scaffold(kind, destPath)`. They may be `.jsx`, `.html`, `.css`, `.md`, or
  another text format, but the extension must match the content.
- `design-skills/*.jsx` are copyable JSX component snippets. The host exposes
  them in the agent virtual filesystem as `skills/<file>.jsx`; despite that
  virtual path, they are source snippets, not markdown method skills.
- `frames/*.jsx` are copyable device/browser frame snippets exposed as
  `frames/<file>.jsx` in the virtual filesystem.

## Workspace DESIGN.md

Workspace `DESIGN.md` is the project-specific design-system baton. It is not a
built-in preset once copied or authored in a workspace. Generated multi-screen,
brand-driven, or reusable work should preserve, repair, and update it as the
source of visual truth.

## Maintenance Checklist

### Method skill upgrades

Startup may refresh only seven known method files: `frontend-design-anti-slop`,
`artifact-composition`, `mobile-mock`, `app-shell-navigation`, `craft-polish`,
`accessibility-states`, and `design-system-baton` (all under `skills/` as `.md`).
An existing file must match exact historical bundled bytes in
`src/main/method-skill-history.ts`; each SHA-256 has git-commit provenance.
These are bundled revision records, not assertions that every revision was a
public release. Line endings and whitespace are not normalized to guess whether
a file was edited. Unknown/custom files, links and junctions are preserved.

Before a recognized file is upgraded, the app journals the old and target hashes
under `<userData>/templates/.codesign-skill-upgrades/<transaction>/`, retains
`original.md`, and publishes the new file with an atomic no-replace operation.
The schema-versioned receipt records an installed hash only for an installation,
not a preserved or restored candidate. Receipts never authorize arbitrary
content, paths or future upgrades. When shipping another revision, retain the
finite previous known hashes with commit evidence; do not learn allowed old
hashes from a user's files or their receipts.

Pending recovery runs before copying missing files, only during startup.
A file created concurrently is never overwritten. Corrupt metadata, changed
backups or unexpected filesystem errors stop startup with a logged
candidate/recovery path rather than guessing how to restore user content.
Inspect those paths and preserve the backup before manually resolving a conflict;
do not delete the template tree to clear an error. The existing `templates.ensure`
log includes method installation/update/unchanged/preserved/recovered counts.
Known hard-link preflight failures (`ENOTSUP`, `EOPNOTSUPP`, `EXDEV`) before any
original is moved are reported as failed upgrades with preserved originals and
an explicit failed count; startup can continue with those old methods. There is
no unsafe overwrite fallback. A failed pending recovery still stops startup.
Missing method files, including fresh installs, use `COPYFILE_EXCL` if publishing
by hard link reports one of those known unsupported codes. This preserves the
original seeder's filesystem compatibility without replacing a concurrent file.
It is not an atomic-publication guarantee for fresh copies; copying errors remain
visible. This fallback never applies to replacement or recovery of existing files.
There is no hot reload, reset UI, or automatic update of private brand references,
workspace `DESIGN.md`, scaffolds, frames or JSX snippets through this mechanism.

### Bundled content

- Keep manifest metadata truthful: category, path, source, license, aliases.
- Keep source format and extension aligned.
- Avoid CDN scripts, external hotlinked assets, and non-MIT-compatible bundled
  code or assets.
- Avoid weak placeholder copy such as "Replace this", "Page content", or
  "Point one".
- Add focused tests when a resource affects loader behavior, manifest output,
  preview classification, or `DESIGN.md` validation.
