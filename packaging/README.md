# Distribution channels

Canonical sources for Open CoDesign's package manager manifests. The `packaging/` tree is the source of truth; after each stable release `release.yml` runs `update-shas.sh` and opens a PR with the synced manifests.

Windows releases publish both NSIS setup exes and portable zip archives. winget uses the setup exes. Scoop uses the zip archives so installation does not depend on unpacking electron-builder's nested NSIS payload; older releases without zip assets use the manifest's legacy NSIS fallback.

Artifacts are still **unsigned** as of v0.2.0. Each channel's README / caveats explains the Gatekeeper or SmartScreen workaround.

## Layout

```
packaging/
├── homebrew/
│   └── Casks/open-codesign.rb
├── winget/
│   └── manifests/o/OpenCoworkAI/OpenCoDesign/<version>/
│       ├── OpenCoworkAI.OpenCoDesign.yaml
│       ├── OpenCoworkAI.OpenCoDesign.installer.yaml
│       └── OpenCoworkAI.OpenCoDesign.locale.en-US.yaml
├── scoop/
│   └── bucket/open-codesign.json
├── flatpak/
│   └── ai.opencowork.codesign.yaml
└── update-shas.sh
```

## Release flow

1. Push a `vX.Y.Z` tag. `release.yml` builds + publishes the installers.
2. After `publish` succeeds, the **`bump-manifests`** job runs `update-shas.sh`: it pulls `SHA256SUMS.txt` from the release, rewrites versions / URLs / checksums across all four channels, and opens or updates `release/vX.Y.Z-manifests` as a PR to `main`. Auto-merge waits for required checks. It never pushes directly to `main` or adds `[skip ci]`.
3. The **`scoop`** job copies the generated Scoop manifest into `OpenCoworkAI/scoop-bucket` when `SCOOP_BUCKET_TOKEN` is configured.
4. The **`homebrew`** job copies the generated cask into `OpenCoworkAI/homebrew-tap` when `HOMEBREW_TAP_TOKEN` is configured.
5. The **`winget`** job submits future bumps after Microsoft accepts the initial package. The v0.2.0 winget PR is microsoft/winget-pkgs#372310.

### Manifest PR credentials and native release gate

Configure the repository Actions secret `RELEASE_BOT_TOKEN` with a fine-grained
PAT restricted to this repository, with **Contents: read/write** and
**Pull requests: read/write** (and required organization approval). Use a dedicated
automation account. This token creates the branch and PR so normal PR checks run;
the built-in `GITHUB_TOKEN` is deliberately not a fallback, because its events do
not start those checks. Do not grant branch-protection bypass or weaken required CI.
Repository auto-merge must be enabled. Missing credentials, failed PR creation,
and failed auto-merge setup fail the sync job visibly, after release publication.
This does not change the separate Homebrew, Scoop, or winget credentials.

Existing manifest PRs whose commits contain `[skip ci]` need a new commit without
that marker (or regeneration through this workflow); enabling token permissions
alone does not repair their missing CI checks.

Release publication now waits for the reusable Intel check on `macos-15-intel`,
including architecture validation and native application smoke testing. Related
workflow and macOS packaging changes also run it on PRs. The check only builds
and tests; it does not publish. A release invocation suppresses its extra DMG
artifact so the release's installer downloads stay unambiguous.

Test the manifest PR logic without credentials or network writes:

```sh
bash .github/scripts/sync-release-manifests.test.sh
```

To run manifest generation manually (e.g. to backfill a past release or test script changes):

```sh
./packaging/update-shas.sh              # uses apps/desktop/package.json version
./packaging/update-shas.sh 0.2.0        # override version
./packaging/update-shas.sh 0.2.0 ./dist # hash local artifacts instead of downloading
PACKAGING_CHANNEL=scoop ./packaging/update-shas.sh 0.2.0
```

The script derives the mac `.app` bundle name and Windows `.exe` from `productName` in `apps/desktop/electron-builder.yml`, so renaming productName propagates into the cask's `app` field and the scoop `bin` automatically.

## Channel-specific mirroring

### SourceForge mirror

The SourceForge mirror is a public convenience mirror, not the primary release source. GitHub Releases remains the source of truth for version numbers, release notes, checksums, SBOMs, and provenance files.

Mirror hygiene checklist after each stable release:

1. Confirm the latest version appears under `https://sourceforge.net/projects/open-codesign.mirror/files/`.
2. Confirm the visible description still points users back to the GitHub repository and website.
3. Download one mirrored binary and verify it against the `SHA256SUMS.txt` attached to the matching GitHub release.
4. Check that screenshots and project summary still match the current release line.

If SourceForge lags, keep public docs wording as "mirror" rather than "official package manager" and point users to GitHub Releases for checksums.

### Homebrew Cask — `OpenCoworkAI/homebrew-tap`

The tap is a separate public repo. For v0.2.0 it is live at `OpenCoworkAI/homebrew-tap`. The release workflow updates it when `HOMEBREW_TAP_TOKEN` is configured. Manual backfill is still a copy, commit, and push:

```sh
# Create the tap repo once:
gh repo create OpenCoworkAI/homebrew-tap --public \
  --description "Homebrew tap for Open CoDesign and friends"
git clone git@github.com:OpenCoworkAI/homebrew-tap.git /tmp/homebrew-tap
mkdir -p /tmp/homebrew-tap/Casks
cp packaging/homebrew/Casks/open-codesign.rb /tmp/homebrew-tap/Casks/
cd /tmp/homebrew-tap && git add -A && \
  git commit -m "open-codesign 0.2.0" && git push
```

Users install with:

```sh
brew tap OpenCoworkAI/tap
brew install --cask open-codesign
```

### winget — `microsoft/winget-pkgs`

Microsoft's monorepo. The initial v0.2.0 package PR is microsoft/winget-pkgs#372310 and is waiting for review. Until Microsoft accepts the package, `winget install OpenCoworkAI.OpenCoDesign` may not resolve. For a first submission, fork `microsoft/winget-pkgs`, copy `packaging/winget/manifests/o/OpenCoworkAI/OpenCoDesign/<version>/` into the same path in the fork, open a PR, and run `wingetcreate validate` first:

```sh
wingetcreate validate packaging/winget/manifests/o/OpenCoworkAI/OpenCoDesign/0.2.0
```

Users install with:

```pwsh
winget install OpenCoworkAI.OpenCoDesign
```

### Scoop — `OpenCoworkAI/scoop-bucket`

Separate public bucket repo. For v0.2.0 it is live at `OpenCoworkAI/scoop-bucket`. Once `SCOOP_BUCKET_TOKEN` is configured with `contents:write` access to that repo, `release.yml` copies `packaging/scoop/bucket/open-codesign.json` into its `bucket/` directory after each stable tag publish. Manual backfill is still just a copy:

```sh
gh repo create OpenCoworkAI/scoop-bucket --public \
  --description "Scoop bucket for Open CoDesign"
git clone git@github.com:OpenCoworkAI/scoop-bucket.git /tmp/scoop-bucket
mkdir -p /tmp/scoop-bucket/bucket
cp packaging/scoop/bucket/open-codesign.json /tmp/scoop-bucket/bucket/
cd /tmp/scoop-bucket && git add -A && \
  git commit -m "open-codesign 0.2.0" && git push
```

Users install with:

```pwsh
scoop bucket add opencoworkai https://github.com/OpenCoworkAI/scoop-bucket
scoop install opencoworkai/open-codesign
```

## Signing status

- macOS: **unsigned / not notarized**. On first launch Gatekeeper shows "damaged, move to Trash". Users run `xattr -cr "/Applications/Open CoDesign.app"` after installing. Older 0.1.2 and earlier builds used `/Applications/open-codesign.app`. Caveat text in the cask surfaces this.
- Windows: **unsigned**. SmartScreen will warn; users click "More info" → "Run anyway". No workaround needed beyond that.
- Linux AppImage: runs as-is.

Code signing + notarization is tracked for Stage 2 (Apple Developer ID + Windows EV cert). Once wired up, drop the Gatekeeper caveat from the cask and the SmartScreen note from the Windows READMEs.
