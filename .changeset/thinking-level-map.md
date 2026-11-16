---
"@open-codesign/shared": minor
"@open-codesign/providers": minor
"@open-codesign/core": minor
"@open-codesign/desktop": minor
---

Add an optional per-provider `thinkingLevelMap` to the v3 config so custom OpenAI-compatible
endpoints can declare the exact reasoning-effort vocabulary they accept:

```toml
[providers.ninfer.thinkingLevelMap]
off = "none"
low = "low"
medium = "medium"
xhigh = "xhigh"
```

The map is a whitelist: listed levels are offered in Settings and forwarded verbatim as
`reasoning_effort`; unlisted levels are marked unsupported so pi-ai clamps them instead of
sending an effort the endpoint rejects. When a stored or in-flight level is not in the
whitelist, the app clamps it onto the closest supported level (deepest first, then
shallowest) before the request is built; `off` is never escalated, and a configured
`off` value such as `none` is sent to endpoints that need it. Presence also implies
`reasoning: true`, which the model-id heuristic cannot infer for local runtimes. Listing
`xhigh` also unlocks the "xhigh" entry, which pi-ai otherwise hides unless the model maps
it.
