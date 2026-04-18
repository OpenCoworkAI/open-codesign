---
title: Architecture
description: How Open CoDesign is laid out across packages and apps.
---

# Architecture

A bird's-eye view. Detailed module READMEs live in each `packages/*/README.md`.

## Shape

```
                  ┌─────────────────────────────┐
                  │   apps/desktop (Electron)   │
                  │  Chat panel │   Canvas      │
                  └─────┬───────┴────────┬──────┘
                        │                │
                ┌───────▼──────┐   ┌─────▼────────┐
                │   core       │   │  runtime     │
                │ orchestration│   │ sandbox iframe│
                └──┬───────────┘   └──────────────┘
                   │
        ┌──────────┼──────────────┐
        ▼          ▼              ▼
   ┌─────────┐ ┌─────────┐  ┌────────────┐
   │providers│ │artifacts│  │ exporters  │
   │ pi-ai + │ │ schema  │  │ PDF / PPTX │
   │wrappers │ └─────────┘  └────────────┘
   └─────────┘
```

## Packages

| Package | Responsibility |
|---|---|
| `apps/desktop` | Electron shell — main process owns SQLite, FS, IPC. Renderer hosts React UI. No business logic here. |
| `packages/core` | Generation orchestration. Prompt + design system + history → providers → artifact stream → events. |
| `packages/providers` | Wraps `@mariozechner/pi-ai` and adds the missing capabilities. App code never imports a provider SDK directly. |
| `packages/runtime` | Sandbox preview. Iframe `srcdoc` + esbuild-wasm + import maps + overlay scripts for inline comments and sliders. |
| `packages/ui` | Design tokens (CSS variables) + Radix-based primitives + Tailwind preset. |
| `packages/artifacts` | Zod schemas for HTML / SVG / slide deck / asset bundle + `<artifact>` streaming parser. |
| `packages/exporters` | PDF / PPTX / ZIP. Each exporter is its own subpath export, dynamic-imported so the cold-start bundle stays lean. |
| `packages/templates` | Built-in demo prompts and starter templates. Read at runtime, not bundled into core. |
| `packages/shared` | Plain types, utilities, zod schemas. No runtime dependencies. |

## Boundaries that must not be crossed

- `apps/desktop` does not import from provider SDKs — go through `packages/providers`.
- `packages/core` does not import from `apps/desktop` or React.
- `packages/ui` knows nothing about LLMs or artifacts.
- Exporters are never bundled into the main shell — they dynamic-import on first use.
- Only `apps/desktop` writes to disk. Other packages go through IPC.

For data-flow walkthroughs (single generation, inline comment, slider drag), see [`docs/ARCHITECTURE.md`](https://github.com/OpenCoworkAI/open-codesign/blob/main/docs/ARCHITECTURE.md).
