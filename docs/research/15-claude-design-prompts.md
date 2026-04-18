# Research 15 — Claude Design System Prompt Structure Analysis

**Date**: 2026-04-18 · **Status**: Reference (informs prompt v1 design, do not copy)

> **Legal note**: This document describes the *structure and design patterns* observed in the leaked Claude Design system prompt. It does not reproduce any original text verbatim. Our own prompt sections in `packages/core/src/prompts/` are independently authored.

## Overview

The leaked Claude Design system prompt is approximately 14,700 tokens across 10 logical sections. The following is a structural analysis of what each section does — not a transcription.

## Section 1 — Identity and scope

Establishes the AI's role as a design-focused assistant. Defines what artifact types it can produce (UI screens, landing pages, presentations, marketing materials). Sets the character: confident design authority, not a general-purpose assistant.

## Section 2 — Artifact output contract

Specifies the exact wrapping format for generated artifacts. Defines identifier, type, and title attributes. Constrains the number of artifacts per response (one). Defines what is permitted outside the artifact tag (short prose summary only).

## Section 3 — Technical stack and construction rules

Enumerates permitted external resources with exact CDN URLs and integrity hashes for specific library versions (React, etc.). Defines inline-only rule for everything else. Specifies CSS-variable-first approach for all tunable values.

## Section 4 — Design quality and aesthetic guidance

Covers typography choices, color space preferences (oklch), layout asymmetry, spacing scale, motion restraint. Includes a list of visual patterns to avoid ("slop" list). References the publicly documented Skills approach to frontend design quality.

## Section 5 — Workflow and reasoning

Describes the expected thought process before generating: understanding intent, exploring directions, self-checking output quality. Defines "done" criteria.

## Section 6 — EDITMODE protocol (tweaks)

This is the most technically distinctive section. Describes the two-way communication protocol between the sandbox iframe and the parent renderer for live parameter tweaks.

### 6a — Embedded parameter block

Tweakable parameters are embedded in the artifact source as a JS object literal surrounded by marker comments:

```
/*EDITMODE-BEGIN*/
{
  "key": "value",
  ...
}
/*EDITMODE-END*/
```

This block lives inside a `<script>` tag in the artifact. The keys correspond 1:1 to CSS custom property names (without the leading `--`). Values are CSS value strings.

### 6b — Message protocol

The parent renderer communicates parameter changes to the iframe via `window.postMessage`:

```js
// Parent → iframe: apply parameter changes
iframe.contentWindow.postMessage(
  {
    type: '__edit_mode_set_keys',
    edits: { 'color-accent': 'oklch(70% 0.25 30)', 'radius-base': '0.75rem' }
  },
  '*'
);
```

The iframe listens for this message type and applies changes via `document.documentElement.style.setProperty`.

### 6c — Persistence

On save, the parent reads the live `getPropertyValue()` values back, merges them into the EDITMODE block, and persists the updated source. The LLM does not need to handle persistence — only the initial embedding and read-back.

## Section 7 — Multi-variant output

In "explore" mode, the prompt guides the model to emit multiple artifact variants (typically 3) in a single response, each with a distinct visual direction. Each variant gets its own artifact tag with a distinct identifier.

## Section 8 — Revision behavior

Defines how the model should handle follow-up requests: minimal-change principle, preserve voice/palette/structure unless explicitly asked to change them, re-read the current artifact before editing.

## Section 9 — Safety and scope limitations

Standard IP protection, phishing prevention, and out-of-scope deflection. Brief (< 100 tokens).

## Section 10 — Skills injection format

Describes how capability "Skills" are serialized and injected into the prompt at runtime. Each skill is a named, versioned block of instructions that can be included or excluded depending on the generation context.

## Implications for open-codesign

Our prompt composer in `packages/core/src/prompts/index.ts` mirrors this 10-section architecture with independently authored text. The EDITMODE protocol described in Section 6 is implemented in `docs/research/11-custom-sliders.md` (corrected 2026-04-18) and `packages/runtime/`.
