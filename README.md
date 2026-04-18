# open-codesign

> Open-source AI design tool — prompt to interactive prototype, slide deck, and marketing assets. Multi-model, BYOK, runs on your laptop.

[Vision](./docs/VISION.md) · [Roadmap](./docs/ROADMAP.md) · [Website](https://opencoworkai.github.io/open-codesign/) · [Contributing](./CONTRIBUTING.md) · [Collaboration](./docs/COLLABORATION.md)

---

**Status**: 🚧 Pre-alpha — designing in public. Not usable yet.

open-codesign is an open-source desktop app that turns natural-language prompts into HTML prototypes, PDF one-pagers, PPTX decks, and design-system-aware mockups. Built as the open counterpart to Claude Design, with multi-provider model support and a local-first storage model.

## Why

- **Multi-model**: Anthropic, OpenAI, Gemini, DeepSeek, local models — bring your own key.
- **Local-first**: Your prompts, designs, and codebase scans never leave your laptop unless you opt in.
- **Lean**: Target install size ≤ 80 MB. No bundled runtimes, no telemetry by default.
- **Ecosystem-friendly**: Designed to handoff to [open-cowork](https://github.com/OpenCoworkAI/open-cowork) for engineering, and to interoperate with Claude Artifacts.

## Install

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

## Status & Roadmap

See [`docs/ROADMAP.md`](./docs/ROADMAP.md). MVP success criterion: replicate every public Claude Design demo.

## License

Apache-2.0
