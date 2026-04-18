---
title: Quickstart
description: Install Open CoDesign and create your first design in 90 seconds.
---

# Quickstart

> Open CoDesign is pre-alpha. Installers ship at v0.5. Until then, run from source.

## 1. Clone and install

```bash
git clone https://github.com/OpenCoworkAI/open-codesign.git
cd open-codesign
pnpm install
```

## 2. Add an API key

Create `~/.config/open-codesign/config.toml`:

```toml
schemaVersion = 1

[providers.anthropic]
key = "sk-ant-…"

# Optional: any OpenAI-compatible endpoint also works
# [providers.openrouter]
# key  = "sk-or-…"
# base = "https://openrouter.ai/api/v1"
```

The provider is auto-detected from the key prefix. No backend, no telemetry, no cloud account.

## 3. Run the desktop shell

```bash
pnpm dev
```

The Electron window opens with eight built-in demo prompts. Pick **Calm Spaces** to render the first prototype end-to-end.

## 4. What you can do next

- Click any element in the preview, leave a comment, watch the model rewrite that region only.
- Drag the AI-generated sliders to tune color, spacing, and typography without re-prompting.
- Point the codebase scanner at one of your repositories — we will extract the design tokens and apply them to every following generation.
- Export to PDF or PPTX from the share menu (lazy-loaded, so the cold-start bundle stays small).

## Going further

- [Architecture](./architecture) — how the packages fit together.
- [Roadmap](./roadmap) — what is shipping when.
- [Vision](https://github.com/OpenCoworkAI/open-codesign/blob/main/docs/VISION.md) — the locked product decisions.
