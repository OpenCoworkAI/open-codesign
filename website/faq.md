---
title: FAQ
titleTemplate: Frequently Asked Questions — Open CoDesign
description: Common questions about Open CoDesign — the open-source desktop AI design tool. Alternative to Claude Design, v0, Bolt.new, Lovable, and Figma AI. BYOK, local-first, MIT licensed.
head:
  - - meta
    - property: og:type
      content: article
---

# Frequently Asked Questions

Answers to the questions people most often ask about Open CoDesign. If your question isn't here, check the [Quickstart](/quickstart) or open a [GitHub Discussion](https://github.com/OpenCoworkAI/open-codesign/discussions).

## What is Open CoDesign?

Open CoDesign is an open-source desktop AI design tool. It turns natural-language prompts into HTML prototypes, React components, slide decks, PDFs, and marketing assets. It is the open-source alternative to Anthropic's Claude Design, Vercel's v0, StackBlitz's Bolt.new, and Lovable — but it runs entirely on your laptop with your own API key, local model endpoint, or ChatGPT subscription login.

## Is Open CoDesign an open-source alternative to Claude Design?

Yes. Open CoDesign is the MIT-licensed, open-source alternative to Anthropic Claude Design. It runs entirely on your desktop, supports any AI model via BYOK (bring your own key), local endpoints, or ChatGPT subscription login, and requires no OpenCoworkAI hosted account. The repository is at [github.com/OpenCoworkAI/open-codesign](https://github.com/OpenCoworkAI/open-codesign).

## How does Open CoDesign compare to v0 by Vercel?

Open CoDesign generates React / JSX components and HTML prototypes from prompts — the same core capability as v0. The differences:

- **Open source vs closed source.** Open CoDesign is MIT-licensed. v0 is closed source.
- **Your models vs their models.** Open CoDesign works with Claude, GPT, Gemini, DeepSeek, Kimi, GLM, Qwen, Ollama, and any OpenAI-compatible endpoint. v0 uses Vercel-hosted OpenAI models only.
- **Local vs cloud.** Open CoDesign runs entirely on your desktop. v0 runs in Vercel's cloud.
- **Files you own vs previews on their platform.** Open CoDesign produces exportable HTML / React / PDF / PPTX / ZIP files. v0 produces previews tied to the Vercel platform.

## How does Open CoDesign compare to Bolt.new?

Bolt.new is a browser-based full-stack app builder running on StackBlitz's WebContainer. Open CoDesign is a desktop app focused on design artifacts (prototypes, slide decks, marketing assets). The differences:

- **Desktop app with persistent local storage** (Open CoDesign) vs **browser sandbox** (Bolt.new).
- **Any LLM via BYOK** (Open CoDesign) vs **Anthropic Claude only** (Bolt.new).
- **Design artifacts** (Open CoDesign) vs **full runnable apps** (Bolt.new).
- **Files on your disk** (Open CoDesign) vs **files inside the WebContainer** (Bolt.new).

## How does Open CoDesign compare to Lovable?

- **Open source** (Open CoDesign, MIT) vs **closed source** (Lovable).
- **Local-first** (Open CoDesign) vs **cloud-hosted** (Lovable).
- **Provider or existing subscription cost only** (Open CoDesign) vs **usage-priced subscription** (Lovable).
- **Design-first prototypes** (Open CoDesign) vs **end-to-end product creation with Supabase** (Lovable).

## How does Open CoDesign compare to Figma AI / Figma Make?

They serve different surfaces. Figma AI operates inside the Figma canvas and produces design frames. Open CoDesign produces code-native artifacts — HTML, React / JSX, PDF, PPTX — outside any proprietary design surface. They are complementary, not direct replacements. If you need designs that hand off cleanly to engineering, Open CoDesign's output is already code.

## Is Open CoDesign free?

Yes. Open CoDesign is MIT licensed. The app itself is free to download, use, modify, and redistribute. You only pay the model route you choose, such as provider token cost or your existing ChatGPT subscription — there is no subscription and no per-token surcharge from us.

## Can I use my Claude Code or Codex setup with Open CoDesign?

Yes. Open CoDesign reads your existing `~/.claude/settings.json` and `~/.codex/config.toml` and imports API-key providers, models, and keys in one click. If Codex is using ChatGPT subscription login, use Open CoDesign's ChatGPT sign-in instead of importing it as an API-key provider. The app calls the selected model route directly — there is no proxy layer or server-side storage.

## Can I log in with my ChatGPT Plus or Codex subscription instead of an API key?

Yes. Open CoDesign supports ChatGPT Plus / Pro / Team subscription login for Codex models and image generation. One click, no API key required.

## Does Open CoDesign send my prompts or designs to any third party?

No. Designs, prompts, and scans live on your machine. v0.2 stores design sessions in JSONL and keeps generated sources in workspace files, with configuration in `~/.config/open-codesign/config.toml`. The only outbound network traffic is directly to the model route you configure, such as a provider API, local gateway, or ChatGPT subscription endpoint. No telemetry by default.

## Which AI models does Open CoDesign support?

- **Anthropic Claude** (Opus, Sonnet, Haiku — all versions)
- **OpenAI GPT** (GPT-5.4, GPT-4o, GPT-4 Turbo, O1, O3, O4)
- **Google Gemini** (including third-party relays with `models/` prefix)
- **DeepSeek** (V3, R1)
- **OpenRouter** (every model on the platform)
- **SiliconFlow** (Chinese models like Qwen, Kimi, GLM)
- **Kimi** (Moonshot)
- **GLM** (Zhipu)
- **Qwen** (Alibaba)
- **Ollama** (any local model)
- **Any OpenAI-compatible endpoint** — covers internal proxies, gateway services, CLIProxyAPI, and self-hosted relays.

Keyless (IP-allowlisted) corporate proxies are also supported, as are ChatGPT Plus / Codex subscription logins.

## Which platforms are supported?

- **macOS** — Apple Silicon (M1 / M2 / M3 / M4) and Intel
- **Windows** — x64 and ARM64
- **Linux** — AppImage, `.deb` (Debian / Ubuntu), `.rpm` (Fedora / RHEL)

Heavy features like PDF export (local Chrome) and PPTX generation are lazy-loaded on first use, so the base install stays small.

## How do I install Open CoDesign?

Fastest: use a package manager.

```bash
# macOS
brew install --cask opencoworkai/tap/open-codesign

# Windows
scoop bucket add opencoworkai https://github.com/OpenCoworkAI/scoop-bucket
scoop install opencoworkai/open-codesign
```

Or download the installer directly from [GitHub Releases](https://github.com/OpenCoworkAI/open-codesign/releases). Every release ships `SHA256SUMS.txt` and a CycloneDX SBOM for verification. The winget package is submitted and waiting for Microsoft review; once it merges, `winget install OpenCoworkAI.OpenCoDesign` will become the Windows one-liner.

## Does Open CoDesign work offline?

Yes, when used with a local model runtime like Ollama. All generation flows through the same OpenAI-compatible endpoint abstraction, so local and hosted models behave identically from the app's perspective. The app itself requires no internet connection after install; only the model call requires whatever network the chosen provider needs.

## What kind of output can Open CoDesign produce?

- **HTML prototypes** — sandboxed iframe, inlined CSS, no external runtime dependencies. Deploy as a single file.
- **React / JSX components** — vendored React 18 + Babel, rendered on-device. Copy-paste into your own project.
- **Slide decks** — PPTX via `pptxgenjs`, editable in PowerPoint / Keynote.
- **PDF one-pagers** — rendered via Puppeteer-core against your local Chrome install.
- **ZIP asset bundles** — HTML + CSS + JS + assets, deterministic layout. For handoff to engineering.
- **Markdown exports** — with embedded frontmatter for static-site ingestion.
- **AI-generated bitmap assets** — hero images, backgrounds, illustrations, logos, generated via OpenAI image models, OpenRouter image models, or signed-in ChatGPT subscription. Opt-in, off by default.

## What changed in v0.2?

v0.2 is the Agentic Design update. It turns Open CoDesign from a one-shot prompt-to-artifact generator into a local design agent:

- **Workspace-backed designs** — every design is a pi session with JSONL history and real files on disk
- **Permissioned local tools** — read, write, edit, bash, grep, find, and ls flow through Open CoDesign's permission UI
- **Design-specific tools** — `ask`, `scaffold`, `skill`, `preview`, `gen_image`, `tweaks`, `todos`, and `done`
- **Preview self-checks** — the agent can render artifacts, inspect console and asset errors, and use screenshots when the model supports vision
- **Progressive skill disclosure** — design skills, scaffolds, and brand references lazy-load when the agent needs them
- **`DESIGN.md` as design-system memory** — brand values and tokens stay in editable files, not model memory
- **v0.1 migration** — existing SQLite designs migrate into workspaces and session history

See the [roadmap](/roadmap) for the milestone plan.

## Is Open CoDesign secure?

The security model is:

- **Local-first.** Designs, prompts, and scans never leave your machine.
- **Config on disk, local credential storage.** API keys live in `~/.config/open-codesign/config.toml`; ChatGPT OAuth tokens stay in the app config token store.
- **No proxy layer.** Your API key or ChatGPT OAuth token is used directly with the selected model route.
- **No telemetry by default.** No analytics, no auto-update tracking.
- **Signed SBOM per release.** CycloneDX supply-chain manifest attached to every GitHub Release.
- **MIT license.** Audit the source yourself.

Installers are unsigned as of v0.2.0. Apple Developer ID notarization and Windows Authenticode signing land in v0.5. Until then, the repo documents reliable manual-install instructions for each platform.

## How can I contribute to Open CoDesign?

- **Report bugs** — open an issue with reproduction steps.
- **Suggest features** — use [GitHub Discussions → Ideas](https://github.com/OpenCoworkAI/open-codesign/discussions/categories/ideas).
- **Send PRs** — read [CONTRIBUTING.md](https://github.com/OpenCoworkAI/open-codesign/blob/main/CONTRIBUTING.md). Sign commits with DCO, run `pnpm lint && pnpm typecheck && pnpm test`, add a changeset.
- **Share what you built** — post in [Show & Tell](https://github.com/OpenCoworkAI/open-codesign/discussions/categories/show-and-tell). Standout posts get featured in release notes.

## Where can I get help?

- [GitHub Discussions → Q&A](https://github.com/OpenCoworkAI/open-codesign/discussions/categories/q-a) for usage questions
- [GitHub Issues](https://github.com/OpenCoworkAI/open-codesign/issues) for reproducible bugs
- [LINUX DO](https://linux.do/) (the primary Chinese-speaking community)
- WeChat group — QR code in the [README](https://github.com/OpenCoworkAI/open-codesign#community)
