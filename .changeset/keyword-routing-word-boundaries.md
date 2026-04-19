---
"@open-codesign/core": patch
---

Word-boundary the progressive-disclosure keyword regexes so substring tokens
no longer false-trigger sections. Previously `metric` matched `biometric`,
`graph` matched `paragraph`, and `logo` matched `logout`. English tokens are
now anchored with `\b...\b` (with optional `s?` for plurals); CJK alternations
remain un-anchored.
