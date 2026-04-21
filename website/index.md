---
layout: home
title: Open CoDesign
titleTemplate: Open-Source AI Design Tool — BYOK, Local-First, Apache-2.0
description: Open CoDesign is an open-source desktop AI design tool — a self-hosted alternative to Claude Design. Bring your own API key (Anthropic, OpenAI, Gemini, DeepSeek, Ollama). Everything runs locally. Apache-2.0.

hero:
  name: Open CoDesign
  text: Design with intent.
  tagline: An open-source desktop AI design tool. Bring your own model, keep everything local — a self-hosted alternative to Claude Design, built for teams who can't afford subscription lock-in.
  image:
    src: /logo-hero.png
    alt: Open CoDesign — open-source AI design tool
  actions:
    - theme: brand
      text: Download for macOS
      link: https://github.com/OpenCoworkAI/open-codesign/releases
    - theme: alt
      text: Star on GitHub
      link: https://github.com/OpenCoworkAI/open-codesign
    - theme: alt
      text: Quickstart (90 s)
      link: /quickstart

features:
  - icon: 🪶
    title: Bring your own model
    details: Anthropic, OpenAI, Gemini, DeepSeek, OpenRouter, SiliconFlow, local Ollama, or any OpenAI-compatible relay — including keyless (IP-allowlisted) proxies. Switch providers in Settings. We don't proxy, we don't charge per token.
  - icon: ⚡
    title: Import in one click
    details: Already using Claude Code or Codex? Open CoDesign reads your existing config — providers, models, API keys — and brings it all in with a single click.
  - icon: 🏡
    title: Your laptop is the cloud
    details: Designs, prompts, codebase scans — SQLite + encrypted TOML on disk. No mandatory account, no telemetry by default. 100% local.
  - icon: 🪄
    title: Twelve design skills, not magic
    details: Twelve built-in design skill modules ship out of the box — dashboards, landing pages, slide decks, pricing pages, chat UIs, data tables, calendars, glassmorphism, editorial typography and more. Drop a SKILL.md into any project to teach the model your own taste.
  - icon: 🎚️
    title: AI-tuned sliders
    details: The model emits the parameters worth tweaking — color, spacing, font — and you drag to refine. No round-tripping the LLM for every nudge.
  - icon: 🔀
    title: Instant design switching
    details: Hop between your last five designs with zero delay. Preview iframes stay alive in memory — no reparse, no white flash, no waiting for snapshots to reload.
  - icon: 📱
    title: Desktop, tablet, phone
    details: Preview any artifact in a true phone frame or tablet width, side-by-side with the full canvas. See the responsive story before you export.
  - icon: 💬
    title: Comment, don't retype
    details: Click any element in the preview to drop a pin. Leave a note. The model rewrites only that region — no more re-prompting the whole page to move a button.
  - icon: 🧬
    title: Codebase to design system
    details: Point at a local repo. We extract Tailwind tokens, CSS vars, and W3C design tokens — every subsequent generation respects them. Coming soon.
  - icon: 📐
    title: Versions, diffs, snapshots
    details: Every iteration is a snapshot. Diff two versions side-by-side. Roll back. Fork. The history Claude Design doesn't have. Coming soon.
  - icon: 💸
    title: Cost transparency
    details: Token estimate before each generation. Weekly spend in the toolbar. Set a budget, get warned, never get surprised. Coming soon.
  - icon: 🚢
    title: Five exports, real files
    details: HTML (inlined CSS), PDF (via your local Chrome), PPTX, ZIP, and Markdown — all generated on-device. No Canva detour.
---

<script setup>
import { withBase } from 'vitepress'
</script>

<div class="codesign-hero-shot">
  <img :src="withBase('/screenshots/product-hero.png')" alt="Open CoDesign — prompt on the left, live artifact on the right" />
</div>

<SmartDownload />

<div class="codesign-section">

## How it works

<div class="codesign-steps">
  <div class="codesign-step">
    <span class="num">1</span>
    <h3>Bring your own key</h3>
    <p>Anthropic, OpenAI, Gemini, DeepSeek, OpenRouter, Ollama — anything <code>pi-ai</code> speaks. No vendor lock-in.</p>
  </div>
  <div class="codesign-step">
    <span class="num">2</span>
    <h3>Type a prompt</h3>
    <p>Pick one of <strong>fifteen built-in demos</strong> — landing page, dashboard, pitch slide, pricing page, mobile app, chat UI, calendar, blog article, receipt, portfolio, email, and more — or describe your own. The first design renders in seconds in a sandboxed iframe.</p>
  </div>
  <div class="codesign-step">
    <span class="num">3</span>
    <h3>Refine, export, hand off</h3>
    <p>Inline comments, AI sliders, snapshot timeline. Export to HTML, PDF, PPTX, ZIP, or Markdown — all on-device.</p>
  </div>
</div>

</div>

<div class="codesign-section">

## Take a closer look

<p class="lede">Six moments from the app — from first launch to region-level rewrites.</p>

<div class="codesign-gallery">
  <figure>
    <img :src="withBase('/screenshots/comment-mode.png')" alt="Comment mode — click any element, drop a pin, the model rewrites only that region" />
    <figcaption><b>Comment, don't retype.</b> Drop pins on the preview; the model rewrites just that region.</figcaption>
  </figure>
  <figure>
    <img :src="withBase('/screenshots/tweaks-sliders.png')" alt="AI-emitted tweaks panel — color pickers and RGB inputs" />
    <figcaption><b>AI-tuned sliders.</b> The model emits the parameters worth tweaking. Drag, don't re-prompt.</figcaption>
  </figure>
  <figure>
    <img :src="withBase('/screenshots/agent-panel.png')" alt="Live agent panel showing todos and streaming tool calls" />
    <figcaption><b>Watch the agent work.</b> Todos, tool calls, and streamed reasoning — always visible, always interruptible.</figcaption>
  </figure>
  <figure>
    <img :src="withBase('/screenshots/hub-your-designs.png')" alt="Your Designs hub, filled with real generated artifacts" />
    <figcaption><b>Every iteration, kept.</b> Designs live on disk as SQLite snapshots; switch between five in zero ms.</figcaption>
  </figure>
  <figure>
    <img :src="withBase('/screenshots/hub-examples.png')" alt="Built-in example library — fifteen ready-to-run design briefs" />
    <figcaption><b>Fifteen demo briefs.</b> Landing, dashboard, pricing, pitch deck, chat UI — one click to see Open CoDesign in action.</figcaption>
  </figure>
  <figure>
    <img :src="withBase('/screenshots/add-provider-menu.png')" alt="Add provider menu — Claude Code, Codex, custom, and presets" />
    <figcaption><b>Bring your own model.</b> Import Claude Code / Codex configs, or pick any OpenAI-compatible provider.</figcaption>
  </figure>
</div>

</div>

<div class="codesign-section">

## Watch a design come to life

<p class="lede">From a blank prompt to a finished artifact — the agent plans, writes, self-checks, and hands you something with hover states, tabs, and empty states already wired up.</p>

<div class="codesign-demo-video">
  <DemoVideo src="/demos/generate-from-scratch.mp4" label="Generate a design from scratch" />
</div>

</div>

<div class="codesign-section">

## How it compares

<p class="lede">We are not faster than Claude Design. We are different — open, multi-model, and local-first. The open-source alternative for teams that can't afford subscription lock-in or cloud data exposure.</p>

<div class="codesign-comparison">

|                       | Open source    | Models             | Runs locally | Pricing             |
| --------------------- | :------------: | :----------------: | :----------: | :-----------------: |
| **Open CoDesign**     | **Apache-2.0** | **Any (BYOK)**     | **✓**        | **Token cost only** |
| Claude Design         | ✗ Closed       | Opus only          | ✗            | Subscription        |
| v0 by Vercel          | ✗ Closed       | Curated            | ✗            | Subscription        |
| Lovable               | ✗ Closed       | Curated            | ✗            | Subscription        |
| Bolt.new              | Partial        | Curated            | ✗            | Subscription        |

</div>

</div>

<div class="codesign-section">

## Trusted by builders

<div class="codesign-proof">
  <p class="proof-placeholder">⭐ <strong>Star us on GitHub</strong> — every star helps more builders find an open alternative.</p>
  <!-- Replace with real social proof: star count, user quotes, HN/PH mentions -->
</div>

</div>

<div class="codesign-cta">

### Ready to design without the lock-in?

<a href="/open-codesign/quickstart" class="cta-primary">Get started in 90 seconds →</a>
<a href="https://github.com/OpenCoworkAI/open-codesign" class="cta-secondary">View on GitHub</a>

</div>
