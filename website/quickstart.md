---
title: Quickstart
description: Install Open CoDesign and render your first AI-generated prototype in 90 seconds.
---

# Quickstart

Get Open CoDesign running on macOS, Windows, or Linux in three steps.

## 1. Install

### Via package manager (recommended)

```sh
# macOS
brew install --cask opencoworkai/tap/open-codesign

# Windows — Scoop
scoop bucket add opencoworkai https://github.com/OpenCoworkAI/scoop-bucket
scoop install opencoworkai/open-codesign
```

Homebrew and Scoop are live for v0.2.0. The winget manifest has been submitted in microsoft/winget-pkgs#372310 and is waiting for Microsoft review; use Scoop or the direct installer until that PR merges.

### Or direct download

Pick the matching installer from [GitHub Releases](https://github.com/OpenCoworkAI/open-codesign/releases):

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `open-codesign-*-arm64.dmg` |
| macOS (Intel) | `open-codesign-*-x64.dmg` |
| Windows (x64) | `open-codesign-*-x64-setup.exe` |
| Windows (ARM64) | `open-codesign-*-arm64-setup.exe` |
| Linux (AppImage) | `open-codesign-*-x64.AppImage` |
| Linux (Debian/Ubuntu) | `open-codesign-*-x64.deb` |
| Linux (Fedora/RHEL) | `open-codesign-*-x64.rpm` |

GitHub Releases is the primary download source. The [SourceForge mirror](https://sourceforge.net/projects/open-codesign.mirror/files/) can help when GitHub downloads are slow or blocked, but verify the file against the `SHA256SUMS.txt` attached to the same GitHub release before installing.

::: tip Unsigned installer note
Current installers are not notarized or Authenticode-signed yet. **macOS Sequoia 15+**: right-click → Open no longer bypasses Gatekeeper; run `xattr -cr "/Applications/Open CoDesign.app"` once after installing (0.1.2 and earlier used `/Applications/open-codesign.app`). **Windows**: SmartScreen → More info → Run anyway. Prefer a verified build? Compile from source — see [Architecture](./architecture).
:::

## 2. Add a provider

First launch opens the Settings page. Pick one path:

- **ChatGPT subscription** — sign in with ChatGPT to use Codex models without pasting an API key.
- **Import from Claude Code or Codex** — one click, we read your existing config (`~/.codex/config.toml`, `~/.claude/settings.json`) and bring every provider, model, and key over.
- **Manual** — paste any API key. Provider is auto-detected from prefix (`sk-ant-…` → Anthropic, `sk-…` → OpenAI, etc.).
- **Keyless** — for IP-allowlisted proxies (enterprise gateways, local Ollama), leave the key blank.

Supported out of the box: Anthropic Claude, OpenAI GPT, Google Gemini, DeepSeek, OpenRouter, SiliconFlow, local Ollama, ChatGPT subscription login, and any OpenAI-compatible endpoint. API-key credentials stay in `~/.config/open-codesign/config.toml`, encrypted via Electron `safeStorage`; ChatGPT OAuth tokens stay in the app config token store. Nothing is uploaded.

## 3. Type your first prompt

Pick one of fifteen built-in demos from the Hub, or type your own. The first artifact renders in seconds inside a sandboxed iframe — HTML or a live React component, depending on what the prompt calls for.

## What to try next

- **Inline comment** — click any element in the preview, leave a note. The model rewrites only that region.
- **Tunable sliders** — the model exposes the parameters worth tuning (color, spacing, font). Drag to refine without round-tripping.
- **Switch designs** — the last five designs keep their preview iframes alive for zero-delay switching.
- **Export** — HTML, PDF (via your local Chrome), PPTX, ZIP, or Markdown, all generated on-device.

## Build from source

```bash
git clone https://github.com/OpenCoworkAI/open-codesign.git
cd open-codesign
pnpm install
pnpm dev
```

Requires Node 22 LTS and pnpm 9.15+. See [Architecture](./architecture) for the repo layout.

## Going further

- [Architecture](./architecture) — how the packages fit together.
- [Roadmap](./roadmap) — what ships when.
- [GitHub Issues](https://github.com/OpenCoworkAI/open-codesign/issues) — bug reports and feature requests.
