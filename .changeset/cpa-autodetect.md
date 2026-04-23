---
'@open-codesign/desktop': patch
'@open-codesign/i18n': patch
---

feat(settings): auto-detect running CLIProxyAPI and show import banner

When the Models tab mounts, probes `http://127.0.0.1:8317/v1/models` via the existing `testEndpoint` IPC bridge. If CLIProxyAPI is running and no provider is already configured at that address, displays a `LocalCpaImportCard` banner above the provider list offering one-click import into `AddCustomProviderModal`. The banner is dismissible and the preference persists to `localStorage` via key `cpa-detection-dismissed-v1`.
