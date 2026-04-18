---
layout: home
title: Open CoDesign
titleTemplate: Open-Source AI Design Tool — BYOK, Local-First, Apache-2.0
description: Open CoDesign is an open-source desktop AI design tool. Bring your own API key (Anthropic, OpenAI, Gemini, Ollama). Everything runs locally. The open-source alternative to Anthropic Claude Design.

hero:
  name: Open CoDesign
  text: Design with intent.
  tagline: An open-source desktop app for designing with AI. Bring your own model. Keep everything local. The open-source alternative to Anthropic Claude Design.
  image:
    src: /hero.png
    alt: Open CoDesign — prompt to prototype
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
    details: Anthropic, OpenAI, Gemini, DeepSeek, or any OpenAI-compatible relay. Switch providers in Settings. We don't proxy, we don't charge per token.
  - icon: 🏡
    title: Your laptop is the cloud
    details: Designs, prompts, codebase scans — SQLite + encrypted TOML on disk. No mandatory account, no telemetry by default. 100% local.
  - icon: 🎚️
    title: AI-tuned sliders
    details: The model emits the parameters worth tweaking — color, spacing, font — and you drag to refine. No round-tripping the LLM for every nudge.
  - icon: 🪄
    title: Skills, not magic
    details: Anti-AI-slop design Skill ships built-in. Add your own SKILL.md to teach the model your taste. No generic outputs.
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
    title: Three exports, real files
    details: HTML (inlined CSS) ships today. PDF (Playwright) and PPTX (pptxgenjs) are coming. All generated locally — no Canva detour.
---

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
    <p>Pick one of eight built-in demos or describe your own. The first design renders in seconds, in a sandboxed iframe.</p>
  </div>
  <div class="codesign-step">
    <span class="num">3</span>
    <h3>Refine, export, hand off</h3>
    <p>Inline comments, AI sliders, snapshot timeline. Export to HTML — PDF and PPTX coming soon.</p>
  </div>
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
