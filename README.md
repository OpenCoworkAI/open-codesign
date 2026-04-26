# Open CoDesign

**简体中文**: [README.zh-CN.md](./README.zh-CN.md)

> Your prompts. Your model. Your laptop.
>
> Turn prompts into polished artifacts — locally, openly, and with whichever model you already pay for.

[Website](https://opencoworkai.github.io/open-codesign/) · [Quickstart](#quickstart) · [What's new](https://github.com/OpenCoworkAI/open-codesign/releases) · [Changelog](./CHANGELOG.md) · [Discussions](https://github.com/OpenCoworkAI/open-codesign/discussions) · [Docs](https://opencoworkai.github.io/open-codesign/quickstart) · [Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md)

**Open-source alternative to:** [Claude Design](https://opencoworkai.github.io/open-codesign/claude-design-alternative) · [v0 by Vercel](https://opencoworkai.github.io/open-codesign/v0-alternative) · [Lovable](https://opencoworkai.github.io/open-codesign/lovable-alternative) · [Bolt.new](https://opencoworkai.github.io/open-codesign/bolt-alternative) · [Figma AI](https://opencoworkai.github.io/open-codesign/figma-ai-alternative)

<p align="center">
  <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/product-hero.png" alt="Open CoDesign — prompt on the left, live artifact on the right" width="1000" />
</p>

<p align="center">
  <a href="https://github.com/OpenCoworkAI/open-codesign/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/OpenCoworkAI/open-codesign?label=release&color=c96442" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue" /></a>
  <a href="https://github.com/OpenCoworkAI/open-codesign/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/OpenCoworkAI/open-codesign/ci.yml?label=CI" /></a>
  <a href="https://github.com/OpenCoworkAI/open-codesign/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/OpenCoworkAI/open-codesign?style=social" /></a>
  <a href="#community"><img alt="WeChat Group" src="https://img.shields.io/badge/WeChat-Group-07C160?logo=wechat&logoColor=white" /></a>
</p>

<p align="center">
  <a href="https://github.com/OpenCoworkAI/open-codesign/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/OpenCoworkAI/open-codesign?label=last%20commit&color=40b4a1" /></a>
  <a href="https://github.com/OpenCoworkAI/open-codesign/pulse"><img alt="Commit activity" src="https://img.shields.io/github/commit-activity/m/OpenCoworkAI/open-codesign?label=commits%2Fmonth" /></a>
  <a href="https://github.com/OpenCoworkAI/open-codesign/graphs/contributors"><img alt="Contributors" src="https://img.shields.io/github/contributors/OpenCoworkAI/open-codesign" /></a>
  <a href="https://github.com/OpenCoworkAI/open-codesign/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/OpenCoworkAI/open-codesign/total?label=downloads&color=6c5ce7" /></a>
</p>

<p align="center">
  <sub><code>claude-code</code> · <code>claude-design-alternative</code> · <code>v0-alternative</code> · <code>bolt-alternative</code> · <code>lovable-alternative</code> · <code>figma-alternative</code> · <code>ai-design</code> · <code>design-to-code</code> · <code>prompt-to-design</code> · <code>ai-prototyping</code> · <code>desktop-design-tool</code> · <code>byok</code> · <code>local-first</code> · <code>multi-model</code> · <code>electron</code></sub>
</p>

---

## What's new

- **`feat/decompose-to-ui-kit`** *(branch)* — Image → componentized `ui_kits/<slug>/` bundle for coding-agent handoff · Boolean-per-dimension visual parity judge (12 standard checks) · Verify-and-iterate loop · Per-decompose cost row · See [BENCHMARKS.md](./BENCHMARKS.md). Closes [#225](https://github.com/OpenCoworkAI/open-codesign/issues/225).
- **v0.1.4** *(coming)* — 🎨 AI image generation · ChatGPT Plus/Codex subscription support · CLIProxyAPI one-click import · API config hardening
- **v0.1.3** *(2026-04-21)* — Gemini `models/` prefix fix · OpenAI-compatible relay "instructions required" fix · third-party relay SSE-truncation hint
- **v0.1.2** *(2026-04-21)* — Release pipeline · Homebrew / winget / Scoop packaging manifests

[Full release history →](https://github.com/OpenCoworkAI/open-codesign/releases) · [Changelog →](./CHANGELOG.md)

---

## What it is

Turn a prompt into a polished prototype, slide deck, or marketing asset, locally, with the model you already use.

**Open CoDesign is the open-source Claude Design alternative** — built for people who want the speed of AI-native design tools without subscription lock-in, cloud-only workflows, or being forced onto a single provider. An MIT-licensed desktop app, local-first from day one, with BYOK for any model (Claude, GPT, Gemini, DeepSeek, Kimi, GLM, Ollama, or any OpenAI-compatible endpoint). One-click import of your existing Claude Code or Codex API key gets you running in under 90 seconds.

---

## See it generate

From a blank prompt to a finished artifact, the agent plans, writes, self-checks, and ships something with hover states, tabs, and empty states already wired up:

![Generate a design from scratch](https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/demos/generate-from-scratch.gif)

---

## Why people star it

- **Runs on your laptop** — no mandatory cloud workspace
- **Works with your model** — Claude, GPT, Gemini, Ollama, OpenRouter, and more
- **Exports real files** — HTML, PDF, PPTX, ZIP, Markdown
- **Shows its work** — live agent activity, visible tool calls, interruptible generation

---

## Why Open CoDesign?

Open source, desktop-native, and built for people who do not want their design workflow locked to one model or one cloud.

| | **Open CoDesign** | Claude Design | v0 by Vercel | Lovable |
|---|:---:|:---:|:---:|:---:|
| Open source | ✅ MIT | ❌ Closed | ❌ Closed | ❌ Closed |
| Desktop native | ✅ Electron | ❌ Web only | ❌ Web only | ❌ Web only |
| Bring your own key | ✅ Any provider | ❌ Anthropic only | ❌ Vercel only | ⚠️ Limited |
| Local / offline | ✅ Fully local app | ❌ Cloud | ❌ Cloud | ❌ Cloud |
| Models | ✅ 20+ (Claude, GPT, Gemini, Ollama…) | Claude only | GPT-4o | Multi-LLM |
| Version history | ✅ Local SQLite snapshots | ❌ | ❌ | ❌ |
| Data privacy | ✅ On-device app state | ❌ Cloud-processed | ❌ Cloud | ❌ Cloud |
| Editable export | ✅ HTML, PDF, PPTX, ZIP, Markdown | ⚠️ Limited | ⚠️ Limited | ⚠️ Limited |
| Price | ✅ Free app, token cost only | 💳 Subscription | 💳 Subscription | 💳 Subscription |

---

## Highlights

<table>
  <tr>
    <td width="50%">
      <a href="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/comment-mode.png">
        <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/comment-mode.png" alt="Click any element, leave a pin, let the model rewrite that region" />
      </a>
      <p><b>Comment, don’t retype.</b><br/>Click any element, drop a pin, and let the model rewrite only that region.</p>
    </td>
    <td width="50%">
      <a href="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/tweaks-sliders.png">
        <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/tweaks-sliders.png" alt="AI-emitted tweaks panel with color pickers and RGB inputs" />
      </a>
      <p><b>AI-tuned sliders.</b><br/>The model surfaces the parameters worth tweaking, so you can refine color, spacing, and typography without another full prompt.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/hub-your-designs.png">
        <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/hub-your-designs.png" alt="Your Designs hub, filled with real generated artifacts" />
      </a>
      <p><b>Every iteration, kept.</b><br/>Designs are saved locally, with instant switching between recent versions.</p>
    </td>
    <td width="50%">
      <a href="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/agent-panel.png">
        <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/agent-panel.png" alt="Live agent panel showing todos and streaming tool calls" />
      </a>
      <p><b>Watch the agent work.</b><br/>Todos, tool calls, and live progress stay visible and interruptible throughout generation.</p>
    </td>
  </tr>
</table>

---

## Quickstart

**Time to first artifact:** about 3 minutes

**Requires:** one API key or local Ollama

**Runs on:** macOS 12+ (Monterey or later), Windows 10+, Linux (glibc ≥ 2.31)

### 1. Install

**One-liner** (recommended):

```bash
# Windows
winget install OpenCoworkAI.OpenCoDesign

# macOS
brew install --cask opencoworkai/tap/open-codesign
```

**Or direct download** (v0.1.x) from [GitHub Releases](https://github.com/OpenCoworkAI/open-codesign/releases):

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `open-codesign-*-arm64.dmg` |
| macOS (Intel) | `open-codesign-*-x64.dmg` |
| Windows (x64) | `open-codesign-*-x64-setup.exe` |
| Windows (ARM64) | `open-codesign-*-arm64-setup.exe` |
| Linux (x64, AppImage) | `open-codesign-*-x64.AppImage` |
| Linux (x64, Debian/Ubuntu) | `open-codesign-*-x64.deb` |
| Linux (x64, Fedora/RHEL) | `open-codesign-*-x64.rpm` |

Each release ships with `SHA256SUMS.txt` and a CycloneDX SBOM (`*-sbom.cdx.json`) so you can verify what you downloaded.

<details>
<summary><b>More package managers</b></summary>

| Manager | Command | Status |
|---|---|---|
| Scoop (Windows) | `scoop bucket add opencoworkai https://github.com/OpenCoworkAI/scoop-bucket && scoop install open-codesign` | 🟢 Live |
| Flathub (Linux) | `flatpak install flathub ai.opencowork.codesign` | ⏸ Deferred to v0.2 (needs signed build + AppStream metadata) |
| Snap (Linux) | `snap install --dangerous open-codesign-*.snap` | 🟡 Attached to releases best-effort; Snap Store publish not yet wired |

After each tag push, CI auto-syncs SHAs back into `packaging/` and (once the winget PR merges) auto-opens downstream bumps. Every `packaging/*/README.md` documents its own mirror flow.
</details>

> **v0.1 note:** installers are unsigned. On **macOS Sequoia 15+** right-click → Open no longer bypasses Gatekeeper, and "Open Anyway" in System Settings often fails. Reliable one-liner:
>
> ```sh
> xattr -cr "/Applications/Open CoDesign.app"
> ```
>
> Then double-click normally. (Older 0.1.x builds are installed as `/Applications/open-codesign.app`.)
> On **Windows**: SmartScreen → More info → Run anyway.
>
> Want a verified build? Compile from source — see [CONTRIBUTING.md](./CONTRIBUTING.md).

### 2. Add your API key

On first launch, Open CoDesign opens the Settings page. Paste any supported provider key:

- Anthropic (`sk-ant-…`)
- OpenAI (`sk-…`)
- Google Gemini
- Any OpenAI-compatible relay (OpenRouter, SiliconFlow, local Ollama)

Credentials stay in `~/.config/open-codesign/config.toml` (file mode 0600, same convention as Claude Code, Codex, and `gh` CLI). Nothing leaves your machine unless your chosen model provider requires it.

### 3. Type your first prompt

Pick one of **fifteen built-in demos** — landing page, dashboard, pitch slide, pricing, mobile app, chat UI, event calendar, blog article, receipt/invoice, portfolio, settings panel, and more — or describe your own. A sandboxed prototype appears in seconds.

---

## Bring your stack

Already using Claude Code or Codex? Your providers, models, and API keys import in one click, with no copy-paste and no need to re-enter settings:

![Import from Claude Code or Codex in one click](https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/demos/claude-code-import.gif)

---

## Built-in taste

Generic AI tools tend to produce generic output. Open CoDesign ships with **twelve built-in design skill modules** — slide decks, dashboards, landing pages, SVG charts, glassmorphism, editorial typography, heroes, pricing, footers, chat UIs, data tables, and calendars — plus a built-in taste layer that steers the model toward considered typography, purposeful whitespace, and meaningful color.

Every skill is available in every generation. Before the model writes a line of CSS, it selects the skills that fit the brief and reasons through layout intent, design-system coherence, and contrast, bringing higher-quality design behavior to whichever model you choose.

Add a `SKILL.md` to any project to teach the model your own taste.

---

## What you get

### Models and providers
- **Unified provider model** — Anthropic, OpenAI, Gemini, DeepSeek, OpenRouter, SiliconFlow, local Ollama, or any OpenAI-compatible relay; keyless (IP-allowlisted) proxies supported
- **One-click import** from Claude Code and Codex configs — bring your existing providers, models, and keys in a single click
- **Dynamic model picker** — every provider exposes its real model catalogue, not a hardcoded shortlist

### Generation and editing
- **Prompt → HTML or JSX/React component** prototype, rendered in a sandboxed iframe (vendored React 18 + Babel on-device)
- **Fifteen built-in demos + twelve design skill modules** — ready-to-edit starting points for common design briefs
- **Live agent panel** — watch tool calls stream in real time as the model edits files
- **AI-generated sliders** — the model emits the parameters worth tweaking (color, spacing, font)
- **Comment mode** — click any element in the preview to drop a pin, leave a note, and let the model rewrite only that region
- **Decompose to UI Kit** — one click in the chat sidebar emits a `ui_kits/<slug>/` folder (`index.html` + `components/*.tsx` + `tokens.css` + `manifest.json` + `README.md`) shaped for coding-agent handoff. Built-in deterministic + vision verifiers self-check parity using a 12-question boolean rubric (no floating-point arbitrary scores) and re-iterate on gaps. Per-decompose cost surfaces inline as a toast. See [BENCHMARKS.md](./BENCHMARKS.md).
- **Generation cancellation** — stop mid-stream without losing prior turns

### Preview and workflow
- **Phone / tablet / desktop preview** — true responsive frames, switch with one click
- **Files panel** — inspect multi-file artifacts (HTML, CSS, JS) before export
- **Instant design switching** — the last five designs keep their preview iframes alive, so Hub ↔ Workspace and sidebar navigation stay zero-delay
- **Connection diagnostic panel** — one-click test for any provider, with actionable errors
- **Per-generation token counter** — see exactly how many tokens each run cost in the sidebar
- **Settings with four tabs** — Models, Appearance, Storage, and Advanced
- **Light + dark themes**, **EN + 简体中文 UI** with live toggle

### Export and packaging
- **Five export formats** — HTML (inlined CSS), PDF (local Chrome), PPTX, ZIP, Markdown
- **GitHub Release pipeline** — unsigned DMG (macOS), EXE (Windows), AppImage (Linux). Code-signing lands in v0.5 along with opt-in auto-update

---

## Roadmap

We're on v0.1.3 — shipping fast, priorities can shift. This is what's on the bench right now.

### Now — v0.1.x polish

- **Provider & API config polish** — smoother one-click import, model picker reaching the last gaps (custom providers, timeouts), clearer connection diagnostics
- **Structured logging + issue-report bundle** — better logs in the main/renderer processes and a one-click diagnostics export that makes bug reports actionable

### Next — v0.2 (headline theme: filesystem & import)

- **Filesystem support** — read/write real project directories, not just in-app scratch space
- **Broader import paths** — bring existing assets, prompts, and project context into a design session

### Later — v0.3 and beyond

- Cost transparency — pre-generation estimate + weekly budget (per-generation token count already shipped)
- Version snapshots + side-by-side diff
- Three-style parallel exploration
- Codebase → design system (token extraction)
- Code-signing (Apple ID + Authenticode) + opt-in auto-update — v0.5
- Figma layer export — post-1.0

Have a different priority in mind? [Open an issue](https://github.com/OpenCoworkAI/open-codesign/issues/new/choose) or 👍 an existing one — we do read them.

---

## Star History

<p align="center">
  <a href="https://star-history.com/#OpenCoworkAI/open-codesign&Date">
    <img
      alt="Star History Chart"
      src="https://api.star-history.com/image?repos=OpenCoworkAI/open-codesign&type=Date"
      width="720"
    />
  </a>
</p>

---

## Built on

- Electron + React 19 + Vite 6 + Tailwind v4
- `@mariozechner/pi-ai` (multi-provider model abstraction)
- `better-sqlite3`, `electron-builder`

## Reporting issues

Found a bug or have a feature request?

1. **Search** [existing issues](https://github.com/OpenCoworkAI/open-codesign/issues) first.
2. **Generate a diagnostics bundle** — Settings → Storage → Export diagnostics (API keys and prompts are redacted automatically).
3. **Open a new issue** using our [bug report](https://github.com/OpenCoworkAI/open-codesign/issues/new?template=bug_report.yml) or [feature request](https://github.com/OpenCoworkAI/open-codesign/issues/new?template=feature_request.yml) template.
4. For security vulnerabilities, see [SECURITY.md](./SECURITY.md).

## More from OpenCoworkAI 

If you like Open CoDesign, you may also want to check out our earlier project, [Open Cowork](https://github.com/OpenCoworkAI/open-cowork), an open-source AI agent desktop app for Windows and macOS with one-click install, multi-model support, sandbox isolation, and built-in skills.

## Community

Open CoDesign first launched on the [LINUX DO](https://linux.do/) community — thanks to everyone there for the early feedback and discussion.

- **[GitHub Discussions](https://github.com/OpenCoworkAI/open-codesign/discussions)** — share your designs in [Show & Tell](https://github.com/OpenCoworkAI/open-codesign/discussions/categories/show-and-tell), ask questions in [Q&A](https://github.com/OpenCoworkAI/open-codesign/discussions/categories/q-a), and propose features in [Ideas](https://github.com/OpenCoworkAI/open-codesign/discussions/categories/ideas).
- **[LINUX DO](https://linux.do/)** — Chinese-speaking discussion, use tips, and feedback (primary community).
- **GitHub Issues** — [bug reports and reproducible problems](https://github.com/OpenCoworkAI/open-codesign/issues).

### WeChat group

For Chinese-speaking users, we also keep a WeChat group for product updates, usage questions, and community discussion.

<p align="center">
  <img
    src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/community/wechat-group.jpg"
    alt="Open CoDesign WeChat group QR code"
    width="260"
  />
</p>

> ⚠️ The WeChat QR code rotates every 7 days and is currently valid until **April 28**.  
> If the code has expired, please leave a message in [GitHub Issues](https://github.com/OpenCoworkAI/open-codesign/issues) and we will refresh the image in-repo.

See also the Chinese README: [README.zh-CN.md#社群](./README.zh-CN.md#%E7%A4%BE%E7%BE%A4).

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md). Open an issue before writing code, sign commits with DCO, run `pnpm lint && pnpm typecheck && pnpm test` before a PR.

## License

MIT — fork it, ship it, sell it. Third-party notices remain in [NOTICE](./NOTICE).

## Cite this project

If you reference Open CoDesign in a paper, article, or product comparison, please cite the repository as:

```bibtex
@misc{open_codesign_github,
  author       = {OpenCoworkAI Contributors},
  title        = {Open CoDesign: An Open-Source Desktop AI Design Tool},
  year         = {2026},
  howpublished = {\url{https://github.com/OpenCoworkAI/open-codesign}},
  note         = {GitHub repository}
}
````

Or the machine-readable `CITATION.cff` at the repo root.
