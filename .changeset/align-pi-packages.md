---
"@open-codesign/core": patch
"@open-codesign/providers": patch
"@open-codesign/desktop": patch
---

Migrate the pi agent, model, and coding-agent packages together to the maintained 0.79.x releases (at least 0.79.0), which fix extension loading, credential-file, and HTML-export security issues. Align the application's HTTP runtime with pi's fixed Undici 8.10.2 release and require Node.js 22.19.0 or newer.
