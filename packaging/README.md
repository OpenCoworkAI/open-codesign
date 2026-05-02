# Distribution channels

Canonical sources for Open CoDesign's package manager manifests. The `packaging/` tree is the source of truth; after each tag push `release.yml` auto-runs `update-shas.sh` and commits the synced manifests back to `main`.

Windows releases publish both NSIS setup exes and portable zip archives. winget uses the setup exes. Scoop uses the zip archives so installation does not depend on unpacking electron-builder's nested NSIS payload; older releases without zip assets use the manifest's legacy NSIS fallback.

All artifacts are **unsigned** for the v0.1 line. Each channel's README / caveats explains the Gatekeeper or SmartScreen workaround.

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
2. After `publish` succeeds, the **`bump-manifests`** job auto-runs `update-shas.sh`: it pulls `SHA256SUMS.txt` from the release, rewrites versions / URLs / checksums across all four channels (and auto-creates the new winget version directory by copying from the previous one), then commits the diff back to `main` as `chore(release): sync manifests to vX.Y.Z`.
3. The **`scoop`** job copies the generated Scoop manifest into `OpenCoworkAI/scoop-bucket` when `SCOOP_BUCKET_TOKEN` is configured.
4. Other downstream mirroring (tap / winget-pkgs / Flathub) is still handled per-channel — see below.

To run the sync manually (e.g. to backfill a past release or test script changes):

```sh
./packaging/update-shas.sh              # uses apps/desktop/package.json version
./packaging/update-shas.sh 0.1.2        # override version
./packaging/update-shas.sh 0.1.2 ./dist # hash local artifacts instead of downloading
PACKAGING_CHANNEL=scoop ./packaging/update-shas.sh 0.1.2
```

The script derives the mac `.app` bundle name and Windows `.exe` from `productName` in `apps/desktop/electron-builder.yml`, so renaming productName propagates into the cask's `app` field and the scoop `bin` automatically.

## Channel-specific mirroring

### Homebrew Cask — `OpenCoworkAI/homebrew-tap`

The tap is a separate public repo. Clone it, copy `packaging/homebrew/Casks/open-codesign.rb` into its `Casks/`, commit, push.

```sh
# Create the tap repo once:
gh repo create OpenCoworkAI/homebrew-tap --public \
  --description "Homebrew tap for Open CoDesign and friends"
git clone git@github.com:OpenCoworkAI/homebrew-tap.git /tmp/homebrew-tap
mkdir -p /tmp/homebrew-tap/Casks
cp packaging/homebrew/Casks/open-codesign.rb /tmp/homebrew-tap/Casks/
cd /tmp/homebrew-tap && git add -A && \
  git commit -m "open-codesign 0.1.0" && git push
```

Users install with:

```sh
brew tap OpenCoworkAI/tap
brew install --cask open-codesign
```

### winget — `microsoft/winget-pkgs`

Microsoft's monorepo. Fork it, copy `packaging/winget/manifests/o/OpenCoworkAI/OpenCoDesign/<version>/` into the same path in the fork, open a PR. `wingetcreate validate` is worth running first:

```sh
wingetcreate validate packaging/winget/manifests/o/OpenCoworkAI/OpenCoDesign/0.1.2
```

Users install with:

```pwsh
winget install OpenCoworkAI.OpenCoDesign
```

### Scoop — `OpenCoworkAI/scoop-bucket`

Separate public bucket repo. Once `SCOOP_BUCKET_TOKEN` is configured with `contents:write` access to `OpenCoworkAI/scoop-bucket`, `release.yml` copies `packaging/scoop/bucket/open-codesign.json` into its `bucket/` directory after each stable tag publish. Manual backfill is still just a copy:

```sh
gh repo create OpenCoworkAI/scoop-bucket --public \
  --description "Scoop bucket for Open CoDesign"
git clone git@github.com:OpenCoworkAI/scoop-bucket.git /tmp/scoop-bucket
mkdir -p /tmp/scoop-bucket/bucket
cp packaging/scoop/bucket/open-codesign.json /tmp/scoop-bucket/bucket/
cd /tmp/scoop-bucket && git add -A && \
  git commit -m "open-codesign 0.1.0" && git push
```

Users install with:

```pwsh
scoop bucket add opencoworkai https://github.com/OpenCoworkAI/scoop-bucket
scoop install opencoworkai/open-codesign
```

## Signing status

- macOS: **unsigned / not notarized**. On first launch Gatekeeper shows "damaged, move to Trash". Users run `xattr -d com.apple.quarantine /Applications/open-codesign.app`, or right-click the app and choose Open. Caveat text in the cask surfaces this.
- Windows: **unsigned**. SmartScreen will warn; users click "More info" → "Run anyway". No workaround needed beyond that.
- Linux AppImage: runs as-is.

Code signing + notarization is tracked for Stage 2 (Apple Developer ID + Windows EV cert). Once wired up, drop the Gatekeeper caveat from the cask and the SmartScreen note from the Windows READMEs.
