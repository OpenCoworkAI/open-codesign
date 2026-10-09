---
"@open-codesign/desktop": patch
"@open-codesign/i18n": patch
---

Send a system notification when a design run completes or fails, or when the agent asks a question, while the window is in the background. Clicking it brings the window back and opens that design. New installs start with notifications on. Installs upgraded from an earlier version keep them off until you turn on Settings → Advanced → System notifications; the same switch turns them off. On macOS, notifications stop after the last window is closed, until it is opened again. Preferences move to schema version 10.
