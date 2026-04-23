---
'@open-codesign/desktop': minor
'@open-codesign/shared': patch
'@open-codesign/i18n': patch
---

feat(settings): add CLIProxyAPI preset quick-pick

Adds CLIProxyAPI (`router-for-me/CLIProxyAPI`) as a first-class preset in the Add Provider menu. CLIProxyAPI is a Go local proxy on port 8317 that wraps Claude/Codex/Gemini OAuth subscriptions into a unified Anthropic Messages API — heavily requested by the Chinese user base.

- `packages/shared`: new `cli-proxy-api` entry in `PROXY_PRESETS` (anthropic wire, `http://127.0.0.1:8317`)
- `packages/i18n`: `settings.providers.cliProxyApi.*` keys in both `en.json` and `zh-CN.json` (preset name, description, api-key-optional hint, thinking-budget hint, model discovery strings)
- `apps/desktop`: `AddProviderMenu` gains a CLIProxyAPI item that opens `AddCustomProviderModal` pre-filled with the CPA endpoint and anthropic wire; claude-cli identity headers are injected automatically by the existing `shouldForceClaudeCodeIdentity` path (no extra code needed)
