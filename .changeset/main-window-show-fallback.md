---
"@open-codesign/desktop": patch
---

Show the main window via a 2s fallback timer when `ready-to-show` never fires. On software-rendered systems (e.g. VMware/VirtualBox VMs where Chromium falls back to SwiftShader), the compositor never produces a first frame for a hidden window, so the window stayed invisible forever while the app ran healthy underneath.
