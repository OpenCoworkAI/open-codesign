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

## Status & Roadmap

See [`docs/ROADMAP.md`](./docs/ROADMAP.md). MVP success criterion: replicate every public Claude Design demo.

## License

Apache-2.0
