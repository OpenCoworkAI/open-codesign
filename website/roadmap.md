---
title: Roadmap
description: What ships when. Living document, tracked alongside the code.
---

# Roadmap

Living plan from v0.1 → v1.0. Phases are cumulative; each stage builds on the last.

## v0.1 — Shipped (April 2026)

First public release, installers for macOS (DMG), Windows (EXE), and Linux (AppImage).

- Unified provider model — Anthropic, OpenAI, Gemini, DeepSeek, or any OpenAI-compatible relay; keyless (IP-allowlisted) proxies supported
- One-click import from Claude Code and Codex configs
- Dynamic model picker — every provider exposes its real model catalogue
- Prompt → HTML **or JSX/React component** prototype in a sandboxed iframe (vendored React 18 + Babel)
- Live agent panel — tool calls stream in real time
- AI-generated sliders and inline comment mode (pin + AI region-rewrite)
- Instant design switching via preview pool
- Five export formats — HTML, PDF, PPTX, ZIP, Markdown
- Bilingual UI (English + 简体中文)
- Built-in anti-AI-slop design Skill

## v0.1.4 — Shipped (April 2026)

Reliability and provider-access release.

- AI image generation for opt-in bitmap assets
- ChatGPT Plus / Codex subscription login through OAuth, no API key required
- CLIProxyAPI auto-detect and one-click import
- Clearer diagnostics for third-party relay timeouts, SSE truncation, missing `/models`, and incompatible Messages APIs

## v0.2 — Agentic Design (next)

Expected in about one week. v0.2 changes the core loop from one-shot prompt-to-artifact generation into a local design agent with real files.

- Every design is a pi session with JSONL history and a workspace folder
- The agent uses pi built-ins for read, write, edit, bash, grep, find, and ls, gated by Open CoDesign's permission UI
- Design-specific tools cover `ask`, `scaffold`, `skill`, `preview`, `gen_image`, `tweaks`, `todos`, and `done`
- `DESIGN.md` becomes a shared design-system artifact that users and the agent can both edit
- v0.1 SQLite designs migrate into workspace files and session history
- Skills, scaffolds, and brand references lazy-load from manifests with source and license metadata

## v0.2.x — Agentic surface polish

The first follow-up track is renderer depth around the new agent loop.

- Finish and harden the `ask`, `preview`, tweaks, and process-management surfaces
- Add broader Playwright coverage for New Design → ask → scaffold → write → preview → tweaks → done
- Expand v0.1 migration fixtures for edge cases

## v0.3 — Codebase → design system

Point at a local repo; Open CoDesign extracts Tailwind tokens, CSS variables, and W3C design tokens so later generations follow the same system. The extractors (`tailwindExtractor`, `cssVarExtractor`, `dtcgImporter`) are already implemented library-side with test coverage; v0.3 wires them deeper into the desktop UI.

## v0.4 — Web capture + handoff

Playwright-powered web capture (on-demand), handoff bundle to open-cowork, external skill packs.

## v0.5 — Signing + distribution

Apple Developer ID + Windows Authenticode code-signing, opt-in auto-update, Homebrew Cask + winget + Scoop manifests verified.

## v1.0 — Public milestone

Onboarding ≤ 3 steps, full bilingual docs, stable public API for packages/core and packages/providers.

## Deferred (post-1.0)

Real-time collaboration, MCP server interface, Claude Artifacts `<artifact>` import, plugin loading inside open-cowork, hosted demo site, mobile companion (read-only), session branching UI, undo/version rollback.

## Anti-goals

Built-in payment, user accounts, cloud sync, stock asset library, custom model fine-tuning, team admin console.
