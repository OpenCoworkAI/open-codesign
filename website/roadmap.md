---
title: Roadmap
description: What ships when. Living document.
---

# Roadmap

The full source of truth lives in [`docs/ROADMAP.md`](https://github.com/OpenCoworkAI/open-codesign/blob/main/docs/ROADMAP.md). Excerpt below.

## Phase 0 — Foundations (current)

Repo is ready to accept code. Apache-2.0, DCO, pnpm + Turborepo + Biome + TypeScript + Vitest scaffold, CI for lint / typecheck / test / size budget.

## Phase 1 — Spike

Prove the architecture with one demo, no UI polish. Providers wraps pi-ai, runtime renders one HTML artifact in an iframe sandbox, core orchestrates prompt → model → artifact → render. Demo: **Calm Spaces meditation app**.

## Phase 2 — Three demos

PPTX export via `pptxgenjs` + `dom-to-pptx`, PDF via Puppeteer-core against system Chrome, settings page with API key + model picker. Demos: meditation app, case study one-pager, pitch deck.

## Phase 3 — Killer interactions

Inline comment → AI patch loop (str_replace + stable `data-codesign-id`), AI-emitted custom sliders, version timeline with snapshot rollback.

## Phase 4 — Ecosystem features

Codebase scanner → design system extraction, Web Capture (Playwright on demand), handoff bundle to open-cowork. All eight killer demos working.

## Phase 5 — Release polish

Mac notarization + Windows Authenticode, Homebrew Cask + winget + scoop, opt-in auto-update, install size verified ≤ 80 MB, onboarding ≤ 3 steps, public 1.0.

## Deferred (post-1.0)

Real-time collaboration, MCP server interface, Claude Artifacts `<artifact>` import, plugin loading inside open-cowork, hosted demo site, Linux installer, mobile companion (read-only).

## Anti-goals

Built-in payment, user accounts, cloud sync, stock asset library, custom model fine-tuning, team admin console.
