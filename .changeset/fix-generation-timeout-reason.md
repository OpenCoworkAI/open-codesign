---
"@open-codesign/desktop": patch
---

Fix: preserve the generation-timeout reason so long runs no longer surface a bare "Request was aborted." Provider SDKs rewrite aborted fetches into a generic message that drops `signal.reason`; the generate IPC now re-surfaces the stashed `GENERATION_TIMEOUT` CodesignError (with configured seconds + Settings path) when the controller was aborted by our own timer. Settings → Advanced → Generation timeout also gains 10m / 20m / 30m / 1h / 2h choices so the default 1200s and longer full-PDP runs can actually be configured without the dropdown silently downgrading the stored value.
