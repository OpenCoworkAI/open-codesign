---
"@open-codesign/shared": patch
"@open-codesign/i18n": patch
"@open-codesign/desktop": patch
---

Show LiteLLM-specific hints when a LiteLLM Gateway connection test or model discovery fails. A 401 says to set the master or virtual key or turn off keyless mode, a 404 says to check that the base URL ends with /v1, and only a localhost URL also mentions port 4000. A connection refusal says to start the LiteLLM proxy.
