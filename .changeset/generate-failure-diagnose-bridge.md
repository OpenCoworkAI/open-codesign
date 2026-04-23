---
'@open-codesign/desktop': patch
'@open-codesign/shared': minor
'@open-codesign/i18n': patch
---

feat(diagnostics): bridge generate failures to diagnose() hypotheses (#130)

- Main process `codesign:v1:generate` catch block now tags the thrown error with `upstream_status` / `upstream_provider` / `upstream_baseurl` / `upstream_wire` so the renderer can reason about the failure without re-parsing `err.message`.
- New `diagnoseGenerateFailure()` in `@open-codesign/shared` maps generate-time failures to the same `DiagnosticHypothesis` shape the connection-test path already uses: 404 / "404 page not found" → missing `/v1`; 5xx with "not implemented" or "page not found" body → gateway does not implement the provider API; 400 with "instructions" body → openai-responses wire misconfigured; 401/403/429 reuse existing hypotheses.
- Renderer `applyGenerateError` now appends the most-likely-cause sentence to the failure toast description and, for the missing-`/v1` case, surfaces an "Apply fix" action that updates the provider's baseUrl via `config:v1:update-provider` — addressing the Win11 relay-gateway failure in #130 with a one-click fix rather than a dead-end error message.
- Adds new i18n cause keys (`gatewayIncompatible`, `openaiResponsesMisconfigured`, `serverError`) and fix keys (`switchWire`) in en + zh-CN.
