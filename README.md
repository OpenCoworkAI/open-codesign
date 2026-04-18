# Open CoDesign

**简体中文**: [README.zh-CN.md](./README.zh-CN.md)

> An open-source desktop app for designing with AI. Bring your own model, keep everything local.

[Website](https://opencoworkai.github.io/open-codesign/) · [Quickstart](#quickstart) · [Contributing](./CONTRIBUTING.md) · [Vision](./docs/VISION.md)

---

**Status**: Pre-alpha. We're building in public. Not usable yet.

Open CoDesign turns natural-language prompts into HTML prototypes, slide decks, and marketing assets — all running on your laptop, with whichever AI model you bring. It's the open-source counterpart to Anthropic Claude Design, built around three convictions:

1. **Your designs are yours.** Prompts, generated artifacts, and codebase scans live on disk. No mandatory cloud, no telemetry by default.
2. **Your model, your bill.** Bring your own API key (Anthropic / OpenAI / Google / OpenAI-compatible relays). We don't proxy, we don't charge per token.
3. **Your craft, amplified.** Generated work isn't a black box — every artifact ships with the parameters worth tweaking, the version history worth diffing, the design system worth reusing.

## Quickstart

Download the latest installer from the [GitHub Releases](https://github.com/OpenCoworkAI/open-codesign/releases) page.

| Platform | File | Notes |
|---|---|---|
| macOS (Apple Silicon) | `open-codesign-*-arm64.dmg` | See Gatekeeper note below |
| macOS (Intel) | `open-codesign-*-x64.dmg` | See Gatekeeper note below |
| Windows | `open-codesign-*-Setup.exe` | See SmartScreen note below |
| Linux | `open-codesign-*.AppImage` | See AppImage note below |

**macOS — Gatekeeper warning (v0.1 is unsigned)**

Because v0.1 installers are not notarized, macOS will block the double-click open. To run anyway:

1. Right-click (or Control-click) the `.dmg` and choose **Open**.
2. In the dialog that appears, click **Open** again.

You only need to do this once per install.

**Windows — SmartScreen warning (v0.1 is unsigned)**

Windows may show "Windows protected your PC". To proceed:

1. Click **More info**.
2. Click **Run anyway**.

**Linux — AppImage**

```bash
chmod +x open-codesign-*.AppImage
./open-codesign-*.AppImage
```

> **Security note:** v0.1 binaries carry no code-signing certificate. Users who prefer a verified build can compile from source — see [CONTRIBUTING.md](./CONTRIBUTING.md). Code signing (Apple Developer ID + Windows Authenticode) is planned for Stage 2.

## Why Open CoDesign

- **Multi-model, BYOK**: Anthropic, OpenAI, Gemini, DeepSeek, or any OpenAI-compatible relay (OpenRouter, SiliconFlow, DuckCoding, local Ollama). Switch the active provider in Settings.
- **Local-first**: SQLite for design history, encrypted TOML for credentials. Never a cloud dependency.
- **Lean**: Install size budget ≤ 80 MB. No bundled Chromium runtimes, no telemetry.
- **Apache-2.0**: Real OSS. Fork it, ship it, sell it. Keep the NOTICE.

## What's working today

- Multi-provider onboarding — Anthropic, OpenAI, and any OpenAI-compatible relay, configured in Settings.
- Prompt → HTML prototype, rendered in a sandboxed iframe.
- AI-generated sliders: the model emits the design parameters worth tuning (color, spacing, font), you drag to refine.
- Inline comments: click any element in the preview, leave a note, the model rewrites only that region.
- HTML export, with inlined CSS.
- Generation cancellation.
- Settings tabs with per-provider API key management.
- GitHub Release pipeline (unsigned v0.1 installers: macOS DMG, Windows EXE, Linux AppImage).

## What's coming next

- **Cost transparency**: token estimate before you generate, weekly spend in the toolbar, budget warnings.
- **Version snapshots + diff**: every iteration saved. Compare two versions side by side, roll back, fork.
- **Codebase → design system**: point at a local repo — we extract Tailwind tokens, CSS vars, and W3C design tokens. Every subsequent generation respects them.
- **Three-style exploration**: generate three variations in parallel and pick the one that fits.
- **Skills system**: ships with a built-in anti-AI-slop design Skill; add your own `SKILL.md` to teach the model your taste.
- **PPTX and PDF export**: 8–12 slides as editable PPTX; PDF via local Playwright — no Canva detour.

## Why "CoDesign"

> CoDesign = collaborative design. The model proposes, you direct. We don't believe in single-shot magic — we believe in tight loops with the model where you stay in the driver's seat.

## Built on

- Electron + React 19 + Vite 6 + Tailwind v4
- pi-ai (multi-provider model abstraction)
- better-sqlite3, electron-builder

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md). The short version: open an issue before writing code, sign your commits with DCO, run `pnpm lint && pnpm typecheck && pnpm test` before opening a PR.

## License

Apache-2.0
