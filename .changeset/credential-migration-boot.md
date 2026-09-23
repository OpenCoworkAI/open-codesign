---
"@open-codesign/desktop": patch
---

Keep the app bootable when a stored API key cannot be migrated. Preserve unreadable entries, continue migrating valid entries, and log credential-free recovery guidance instead of preventing users from opening Settings. Keep strict decryption when a credential is actually used.
