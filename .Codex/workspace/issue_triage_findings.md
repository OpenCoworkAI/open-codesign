# Issue Triage Findings

## Project Context Read
- `docs/VISION.md`: open-codesign is a local-first Electron app for prompt-to-design artifacts, with all model support routed through `pi-ai`.
- `docs/PRINCIPLES.md`: keep features lean, lazy-load heavy capabilities, avoid silent fallbacks, and ensure public/persistent contracts are versioned.
- Current branch is `dev/v0.2`, ahead of `origin/dev/v0.2` by 4 commits.
- `AGENTS.md` is untracked in the working tree.

## Issue Context
- Recent provider-related issues cluster around provider capability profiles (#206), wire/role/reasoning policy (#207), diagnostics parity (#216), and model discovery modes (#210).
- Gemini-specific bug #175 was closed by merged PR #186, which strips `models/` from Gemini OpenAI-compatible model IDs at the provider wire boundary.
- #175 has a recent follow-up comment: a user confirms the issue still persists in the latest version for Google Gemini models.
- PR #186 review comments identified a separate flaw: Gemini endpoint detection was initially too broad, and even after a follow-up was still host-only rather than requiring an OpenAI-compatible `/openai` path.
- Issue #229 is separate but related provider compatibility work: self-signed TLS and `developer` role rejection by Bedrock-like OpenAI-compatible backends.
- Local code contains the #186 fix in `packages/providers/src/index.ts`, but the live v0.2 generation path uses `packages/core/src/agent.ts::buildPiModel`.
- `buildPiModel` currently sets `id: model.modelId` directly and `reasoning: true` for every provider/wire. This bypasses Gemini `models/` stripping and can also force developer/reasoning behavior on OpenAI-compatible custom providers.
- This explains why #175 can remain visible after being closed: title/legacy provider calls were patched, but the agent runtime path still sends the old model ID shape.
