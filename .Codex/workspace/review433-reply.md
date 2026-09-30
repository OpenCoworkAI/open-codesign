## Security review follow-up — e05f8dd

Addressed the five findings reported on the initial head:

- **Incomplete multi-character sanitization (#188–191):** removed the comment/raw-element/tag/title regex stripping pipeline. HTML is now parsed by lazy-loaded `parse5`, then an iterative walk collects text nodes and omits active/non-content subtrees. No scripts or resources are executed/loaded. The output contract is explicitly untrusted **text**, not sanitized HTML to insert. Added malformed fragments, quoted `>`, entity decoding, hidden/unfinished elements, table boundaries, deep nesting, and bounded fetch/excerpt regressions.
- **Polynomial EDITMODE regex (`packages/runtime/src/index.ts`):** replaced the wildcard regex with a forward-only comment/marker scan. Tests cover complete/multiple blocks, marker whitespace, unmatched input, repeated BEGIN markers, and 50,000-marker input without repeated suffix scans.

No CodeQL alert was dismissed or suppressed.

### Dependency impact

The PR body and `WEB_SEARCH.md` now explicitly disclose the new parser instead of claiming zero dependency additions: `parse5` 8.0.1 (MIT, 337,099 registry-unpacked bytes) plus locked `entities` 8.1.0 (BSD-2-Clause, 330,191 bytes), approximately 652 KiB combined. It is loaded only on HTML fetch; alternatives and why it cannot be an optional peer are documented. The lockfile changes are limited to this dependency chain.

### Verification

- Normal pre-push hooks passed: workspace typechecks/lint, **3,281 package tests + 61 script tests passed**, 4 skipped.
- Desktop build and research/source-export browser integration passed.
- Remote **CI**, **Dependency Review**, **CodeQL analysis/result check**, and **Linux packaging smoke** all passed for `e05f8dd`.
- The latest [CodeQL result](https://github.com/OpenCoworkAI/open-codesign/runs/106182426238) reports **“No new alerts in code changed by this pull request”**, with **0 annotations**, replacing the previous failing five-alert result.

The PR remains a draft for maintainer scope/architecture review; the skipped Codex PR Review job is not a human approval.
