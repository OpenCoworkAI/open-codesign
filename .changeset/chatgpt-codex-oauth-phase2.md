---
"@open-codesign/providers": minor
"@open-codesign/desktop": minor
"@open-codesign/shared": minor
"@open-codesign/core": minor
"@open-codesign/i18n": patch
---

feat(codex): unify ChatGPT subscription path onto pi-ai's built-in openai-codex-responses wire

Phase 2 of the Codex subscription login work. The self-rolled Codex client
path from Phase 1 is replaced by pi-ai's first-class `openai-codex-responses`
adapter (shipped in pi-ai 0.67.68) so every provider — Anthropic, OpenAI,
Gemini, ChatGPT Codex — now runs through the same core/pi-agent-core route
with no provider-specific branching.

### Schema + routing
- `packages/shared`: extend `WireApiSchema` and `CanonicalWire` with
  `openai-codex-responses`; promote `CHATGPT_CODEX_PROVIDER_ID` to shared so
  `provider-settings` references the same literal the OAuth module writes
  without creating a module cycle.
- `canonicalBaseUrl` passes codex URLs through untouched (pi-ai's wire
  appends `/codex/responses` itself); `modelsEndpointUrl` throws for codex
  (no discoverable /models endpoint — providers use `modelsHint`).
- `packages/core`, `packages/providers`: `apiForWire` + `synthesizeWireModel`
  recognize the new wire; all 4 duplicated `'openai-chat' | …` unions
  consolidated onto the shared `WireApi` type.

### Desktop wiring
- New `apps/desktop/src/main/resolve-api-key.ts`: dependency-injected helper
  that routes ChatGPT provider id to the token store's auto-refreshing
  access token, and every other provider to the keychain-backed API key.
  Codex auth failures surface as `CodesignError(PROVIDER_AUTH_MISSING)` so
  the renderer's error-code routing stays consistent with the API-key-missing
  path. Covered by 7 unit tests via DI.
- `main/index.ts`: `resolveActiveApiKeyFromState` replaces the inline
  `isChatgptCodex` validate / dispatch branches in all 4 IPC handlers
  (`codesign:v1:generate`, legacy `codesign:generate`, apply-comment,
  generate-title). Legacy `codesign:generate` no longer rejects codex.
- Long-running agent runs: `GenerateInput.getApiKey` is a new optional async
  getter; the desktop passes it only for codex so pi-agent-core calls back
  into the token store on each LLM round-trip (auto-refreshes within the
  5-min buffer). Mid-run sign-out errors are captured in a closure variable
  and rethrown verbatim from the post-agent branch so the structured
  `PROVIDER_AUTH_MISSING` code isn't lost to pi-agent-core's plain-string
  failure-message flattening.

### Registration + migration
- `codex-oauth-ipc.ts`: provider entry registers `wire=openai-codex-responses`,
  bare `baseUrl=https://chatgpt.com/backend-api`, and the full 9-model catalog
  (gpt-5.1 → gpt-5.4-mini), ordered flagship-first.
- `migrateStaleCodexEntryIfNeeded()` runs once at boot and rewrites any
  Phase-1-shaped `chatgpt-codex` provider (`wire=openai-responses`,
  `baseUrl=/codex`) to the Phase 2 canonical values, so feat-branch testers
  don't need to sign out and back in after upgrade. No-op when the entry is
  absent or already canonical.

### UI
- `ChatgptLoginCard.tsx`: flipped out of "coming soon" mode back to the full
  three-state login/status/logout flow, with i18n keys in both locales.

### Deletions (-963 LOC of Phase 1 code now provided by pi-ai)
- `apps/desktop/src/main/codex-generate.ts` + test
- `apps/desktop/src/main/codex-title.ts`
- `packages/providers/src/codex/client.ts` + test

OAuth-side code (`oauth.ts`, `oauth-server.ts`, `token-store.ts`) is unchanged
— still the only codex-specific code, and it sits outside the generation link.
