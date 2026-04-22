---
'@open-codesign/desktop': patch
'@open-codesign/core': patch
---

fix: send attached screenshots to ChatGPT Codex as image inputs

Image attachments in the desktop app were previously reduced to filename-only hints on the `chatgpt-codex` route, so models like `gpt-5.4` could ignore uploaded screenshots entirely.

This change keeps the existing text-attachment behavior, but reads supported image files into data URLs and forwards them as Responses `input_image` parts for ChatGPT Codex generations.
