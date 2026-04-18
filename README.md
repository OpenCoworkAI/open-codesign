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

## Status & Roadmap

See [`docs/ROADMAP.md`](./docs/ROADMAP.md). MVP success criterion: replicate every public Claude Design demo.

## CI

PR / main pushes run lint + typecheck + test on ubuntu-latest (1-2 min feedback).
Cross-platform builds happen on tag releases (`v*.*.*`) via `release.yml` (mac/win/linux).

Local pre-push hook (auto-installed via `pnpm install`) runs typecheck + lint in seconds
to fail fast before pushing.

## License

Apache-2.0
