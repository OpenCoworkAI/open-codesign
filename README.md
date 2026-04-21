# Open CoDesign

**简体中文**: [README.zh-CN.md](./README.zh-CN.md)

> Your prompts. Your model. Your laptop. A self-hosted alternative to Anthropic Claude Design.

[Website](https://opencoworkai.github.io/open-codesign/) · [Quickstart](#quickstart) · [vs Claude Design](https://opencoworkai.github.io/open-codesign/claude-design-alternative) · [Docs](https://opencoworkai.github.io/open-codesign/quickstart) · [Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md)

<p align="center">
  <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/product-hero.png" alt="Open CoDesign — prompt on the left, live artifact on the right" width="1000" />
</p>

<p align="center">
  <a href="https://github.com/OpenCoworkAI/open-codesign/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/OpenCoworkAI/open-codesign?label=release&color=c96442" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue" /></a>
  <a href="https://github.com/OpenCoworkAI/open-codesign/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/OpenCoworkAI/open-codesign/ci.yml?label=CI" /></a>
  <a href="https://github.com/OpenCoworkAI/open-codesign/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/OpenCoworkAI/open-codesign?style=social" /></a>
</p>

<p align="center">
  <sub>Topics: <code>ai-design</code> · <code>claude-design-alternative</code> · <code>byok</code> · <code>local-first</code> · <code>electron</code> · <code>multi-model</code> · <code>open-source</code></sub>
</p>

---

## What is Open CoDesign?

Open CoDesign turns a natural-language prompt into a polished HTML prototype, slide deck, or marketing asset — entirely on your laptop, with whichever AI model you already pay for. Think of it as Claude Design, minus the subscription lock-in, minus the cloud account, minus the single-model ceiling.

---

## Watch a design come to life

From a blank prompt to a finished artifact — the agent plans, writes, self-checks, and hands you something with hover states, tabs, and empty states already wired up:

![Generate a design from scratch](https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/demos/generate-from-scratch.gif)

---

## Highlights

<table>
  <tr>
    <td width="50%">
      <a href="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/comment-mode.png">
        <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/comment-mode.png" alt="Click any element, leave a pin, let the model rewrite that region" />
      </a>
      <p><b>Comment, don't retype.</b><br/>Click any element, drop a pin, the model rewrites only that region.</p>
    </td>
    <td width="50%">
      <a href="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/tweaks-sliders.png">
        <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/tweaks-sliders.png" alt="AI-emitted tweaks panel with color pickers and RGB inputs" />
      </a>
      <p><b>AI-tuned sliders.</b><br/>The model emits the parameters worth tweaking — drag to refine without a round trip.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/hub-your-designs.png">
        <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/hub-your-designs.png" alt="Your Designs hub, filled with real generated artifacts" />
      </a>
      <p><b>Every iteration, kept.</b><br/>Designs live on disk as SQLite snapshots. Hop between the last five with zero delay.</p>
    </td>
    <td width="50%">
      <a href="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/agent-panel.png">
        <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/agent-panel.png" alt="Live agent panel showing todos and streaming tool calls" />
      </a>
      <p><b>Watch the agent work.</b><br/>Todos, tool calls, and streamed reasoning — fully visible, fully interruptible.</p>
    </td>
  </tr>
</table>

---

## Why Open CoDesign?

| | **Open CoDesign** | Claude Design | v0 by Vercel | Lovable |
|---|:---:|:---:|:---:|:---:|
| Open source | ✅ Apache-2.0 | ❌ Closed | ❌ Closed | ❌ Closed |
| Desktop native | ✅ Electron | ❌ Web only | ❌ Web only | ❌ Web only |
| Bring your own key | ✅ Any provider | ❌ Anthropic only | ❌ Vercel only | ⚠️ Limited |
| Local / offline | ✅ Fully local | ❌ Cloud | ❌ Cloud | ❌ Cloud |
| Models | ✅ 20+ (Claude, GPT, Gemini, Ollama…) | Claude only | GPT-4o | Multi-LLM |
| Version history | ✅ Local SQLite snapshots | ❌ | ❌ | ❌ |
| Data privacy | ✅ 100% on-device | ❌ Cloud-processed | ❌ Cloud | ❌ Cloud |
| Price | ✅ Free, token cost only | 💳 Subscription | 💳 Subscription | 💳 Subscription |

---

## Already using Claude Code or Codex?

Your providers, models, and API keys import in one click — no copy-paste, no re-entering settings:

![Import from Claude Code or Codex in one click](https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/demos/claude-code-import.gif)

---

## Quickstart

### 1. Install

**Package managers** (recommended):

```sh
# macOS — Homebrew
brew tap OpenCoworkAI/tap
brew install --cask open-codesign

# Windows — winget
winget install OpenCoworkAI.open-codesign

# Windows — Scoop
scoop bucket add opencowork https://github.com/OpenCoworkAI/scoop-bucket
scoop install opencowork/open-codesign
```

**Direct download** from [GitHub Releases](https://github.com/OpenCoworkAI/open-codesign/releases):

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `open-codesign-*-arm64.dmg` |
| macOS (Intel) | `open-codesign-*.dmg` |
| Windows (x64 / arm64) | `open-codesign-*-setup.exe` |
| Linux | `open-codesign-*.AppImage` |

> **v0.1 note:** installers are unsigned. macOS: right-click → Open, or run `xattr -d com.apple.quarantine /Applications/open-codesign.app` after install. Windows: SmartScreen → More info → Run anyway.
> Want a verified build? Compile from source — see [CONTRIBUTING.md](./CONTRIBUTING.md).

### 2. Add your API key

First launch opens the Settings page. Paste any provider key:

- Anthropic (`sk-ant-…`)
- OpenAI (`sk-…`)
- Google Gemini
- Any OpenAI-compatible relay (OpenRouter, SiliconFlow, local Ollama)

Credentials stay in `~/.config/open-codesign/config.toml`, encrypted via Electron `safeStorage`. Nothing leaves your machine.

### 3. Type your first prompt

Pick one of **fifteen built-in demos** — landing page, dashboard, pitch slide, pricing, mobile app, chat UI, event calendar, blog article, receipt/invoice, portfolio, settings panel, and more — or describe your own. A sandboxed prototype appears in seconds.

---

## Built-in Anthropic-style design intelligence

Generic AI tools produce generic output. Open CoDesign ships with **twelve built-in design skill modules** — slide decks, dashboards, landing pages, SVG charts, glassmorphism, editorial typography, heroes, pricing, footers, chat UIs, data tables, and calendars — plus an **anti-AI-slop design Skill** that steers the model toward considered typography, purposeful whitespace, and meaningful color, not `#3B82F6` blue buttons on every artifact.

Every skill is already in every generation. Before the model writes a line of CSS, it picks the right skill for the brief and reasons through layout intent, design-system coherence, and contrast — the same editorial discipline behind Claude Design's best outputs, available on any model you bring.

Add a `SKILL.md` to any project to teach the model your own taste.

---

## What's working today

- **Unified provider model** — Anthropic, OpenAI, Gemini, DeepSeek, OpenRouter, SiliconFlow, local Ollama, or any OpenAI-compatible relay; keyless (IP-allowlisted) proxies supported
- **One-click import** from Claude Code and Codex configs — bring your existing providers, models, and keys in a single click
- **Dynamic model picker** — every provider exposes its real model catalogue, not a hardcoded shortlist
- **Prompt → HTML or JSX/React component** prototype, rendered in a sandboxed iframe (vendored React 18 + Babel on-device)
- **Fifteen built-in demos + twelve design skill modules** — ready-to-edit starting points for every common design brief
- **Live agent panel** — watch tool calls stream in real time as the model edits files
- **AI-generated sliders** — the model emits the parameters worth tweaking (color, spacing, font); drag to refine with zero round-trip
- **Comment mode** — click any element in the preview to drop a pin, leave a note, model rewrites only that region
- **Phone / tablet / desktop preview** — true responsive frames, switch with one click
- **Files panel** — inspect multi-file artifacts (HTML, CSS, JS) before export
- **Instant design switching** — the last five designs keep their preview iframes alive, so Hub ↔ Workspace and sidebar navigation stay zero-delay
- **Connection diagnostic panel** — one-click test for any provider, with actionable errors
- **Light + dark themes**, **EN + 简体中文 UI** with live toggle
- **Five export formats** — HTML (inlined CSS), PDF (local Chrome), PPTX, ZIP, Markdown
- **Generation cancellation** — stop mid-stream without losing prior turns
- **Per-generation token counter** — see exactly how many tokens each run cost, right in the sidebar
- **Settings with four tabs** — Models (providers + keys), Appearance (theme/language), Storage (config + data paths), Advanced (update channel)
- **GitHub Release pipeline** — unsigned DMG (macOS), EXE (Windows), AppImage (Linux). Code-signing lands in v0.5 along with opt-in auto-update.

---

## Roadmap

| Feature | Status |
|---|---|
| Multi-provider onboarding + Settings | ✅ Shipped |
| Claude Code / Codex one-click config import | ✅ Shipped |
| Dynamic model picker per provider | ✅ Shipped |
| Keyless (IP-allowlisted) proxy support | ✅ Shipped |
| Prompt → HTML prototype (sandboxed iframe) | ✅ Shipped |
| Prompt → JSX/React component (on-device React 18 + Babel) | ✅ Shipped |
| Live agent activity panel (streaming tool calls) | ✅ Shipped |
| AI-generated tunable sliders | ✅ Shipped |
| Comment mode (pin + AI region-rewrite) | ✅ Shipped |
| Instant design switching (preview pool) | ✅ Shipped |
| Bilingual UI (EN + 简体中文) | ✅ Shipped |
| HTML export (inlined CSS) | ✅ Shipped |
| PDF export (local Chrome) | ✅ Shipped |
| PPTX export | ✅ Shipped |
| ZIP / Markdown export | ✅ Shipped |
| Cost transparency — pre-generation estimate + weekly budget (per-generation token count already shipped) | 🔜 Coming |
| Version snapshots + side-by-side diff | 🔜 Coming |
| Codebase → design system (token extraction) | 🔜 Coming |
| Three-style parallel exploration | 🔜 Coming |
| Code-signing (Apple ID + Authenticode) + opt-in auto-update | 🔜 v0.5 |
| Figma layer export | 🔜 Post-1.0 |

---

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=OpenCoworkAI/open-codesign&type=Date)](https://star-history.com/#OpenCoworkAI/open-codesign&Date)

---

## Cite this project

If you reference Open CoDesign in a paper, article, or product comparison, please use:

```
OpenCoworkAI (2026). open-codesign: Open-source desktop AI design tool.
GitHub. https://github.com/OpenCoworkAI/open-codesign
Apache-2.0 License.
```

Or the machine-readable `CITATION.cff` at the repo root.

---

## Built on

- Electron + React 19 + Vite 6 + Tailwind v4
- `@mariozechner/pi-ai` (multi-provider model abstraction)
- `better-sqlite3`, `electron-builder`

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md). Open an issue before writing code, sign commits with DCO, run `pnpm lint && pnpm typecheck && pnpm test` before a PR.

## License

Apache-2.0 — fork it, ship it, sell it. Keep the [NOTICE](./NOTICE).
