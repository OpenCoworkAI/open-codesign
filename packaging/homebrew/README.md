# Homebrew Cask distribution

Users install with:

```sh
brew tap opencoworkai/tap
brew install --cask open-codesign
```

## One-time tap setup

1. Create a public repo `OpenCoworkAI/homebrew-tap`.
2. Seed it with this cask (copy `open-codesign.rb` into the repo's `Casks/` directory after filling in real SHA256 values from the release).
3. Store a fine-scoped PAT as the `HOMEBREW_TAP_TOKEN` repo secret with `contents:write` on the tap repo.
4. Keep the `homebrew` job in `.github/workflows/release.yml` enabled.

## Per-release automation

The tap repo exists and v0.2.0 is live there. The release workflow bumps the cask on each stable `v*.*.*` tag by regenerating `version` + `sha256` from `SHA256SUMS.txt` and pushing the updated cask when `HOMEBREW_TAP_TOKEN` is configured.

Use a macOS version symbol for the cask requirement (`depends_on macos: :big_sur`), as described in the [Homebrew Cask Cookbook](https://docs.brew.sh/Cask-Cookbook#stanza-depends_on). String comparisons such as `">= :big_sur"` are deprecated.

The release job copies this repository's cask to `OpenCoworkAI/homebrew-tap`. A source change here reaches installed taps after that job runs; to fix the current tap sooner, update its `Casks/open-codesign.rb` with the same requirement and run `brew audit --cask --strict open-codesign` on macOS.
