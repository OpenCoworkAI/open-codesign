---
layout: home
title: Open CoDesign
titleTemplate: An open-source AI design tool

hero:
  name: Open CoDesign
  text: Design with intent.
  tagline: An open-source desktop app for designing with AI. Bring your own model. Keep everything local. The open counterpart to Anthropic Claude Design.
  actions:
    - theme: brand
      text: Quickstart
      link: /quickstart
    - theme: alt
      text: GitHub
      link: https://github.com/OpenCoworkAI/open-codesign

features:
  - icon: 🪶
    title: Bring your own model
    details: Anthropic, OpenAI, Gemini, DeepSeek, or any OpenAI-compatible relay. Switch providers in Settings. We don't proxy, we don't charge.
  - icon: 🏡
    title: Your laptop is the cloud
    details: Designs, prompts, codebase scans — SQLite + encrypted TOML on disk. No mandatory account, no telemetry by default.
  - icon: 🎚️
    title: AI-tuned sliders
    details: The model emits the parameters worth tweaking — color, spacing, font — and you drag to refine. No round-tripping the LLM for every nudge.
  - icon: 🪄
    title: Skills, not magic
    details: Anti-AI-slop design Skill ships built-in. Add your own SKILL.md to teach the model your taste.
  - icon: 🧬
    title: Codebase to design system
    details: Point at a local repo. We extract Tailwind tokens, CSS vars, and W3C design tokens — every subsequent generation respects them.
  - icon: 📐
    title: Versions, diffs, snapshots
    details: Every iteration is a snapshot. Diff two versions side-by-side. Roll back. Fork. The history Claude Design doesn't have.
  - icon: 💸
    title: Cost transparency
    details: Token estimate before each generation. Weekly spend in the toolbar. Set a budget, get warned, never get surprised.
  - icon: 🚢
    title: Three exports, real files
    details: HTML (inlined CSS), PDF (Playwright), PPTX (pptxgenjs). All generated locally. No Canva detour.
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
    <p>Inline comments, AI sliders, snapshot timeline. Export to HTML, PDF, PPTX or hand off to <a href="https://github.com/OpenCoworkAI/open-cowork">open-cowork</a>.</p>
  </div>
</div>

</div>

<div class="codesign-section">

## How it compares

<p class="lede">We are not faster than Claude Design. We are different — open, multi-model, and local-first.</p>

<div class="codesign-comparison">

|                       | Models           | Runs locally | Source         | Pricing             |
| --------------------- | :--------------: | :----------: | :------------: | :-----------------: |
| Claude Design         | Opus only        | ✗            | Closed         | Subscription        |
| v0 by Vercel          | Curated          | ✗            | Closed         | Subscription        |
| Bolt.new              | Curated          | ✗            | Partial        | Subscription        |
| **Open CoDesign**     | **Any (BYOK)**   | **✓**        | **Apache-2.0** | **Token cost only** |

</div>

</div>

<div class="codesign-cta">

### Ready to design without the lock-in?

<a href="/open-codesign/quickstart">Get started in 90 seconds →</a>

</div>
