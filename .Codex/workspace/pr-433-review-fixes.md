# PR 433 review remediation

## Findings
- Current GitHub CI/Dependency Review/CodeQL analysis jobs succeed, but the separate CodeQL result check fails with 5 high alerts.
- Four inline alerts #188–191 in web-research-network.ts flag regex-based multi-character HTML stripping (comments, raw-text elements, tags, title).
- Fifth check annotation flags the existing EDITMODE block regex in packages/runtime/src/index.ts as polynomial on repeated BEGIN markers without END; new call paths expose it.
- No human change request yet; automated Codex review was skipped for the draft.

## Work
1. Replace regex stripping with lazy-loaded parse5 HTML5 parsing, traversing text nodes only and excluding active/non-content subtrees. Do not execute scripts or fetch page assets. Treat all returned text as untrusted text, not sanitized HTML.
2. Verify dependency license, unpacked size, alternatives and lazy loading; update public docs/PR claims from no runtime additions to the exact parser cost. parse5 already occurs transitively in the workspace but must be declared directly for shipped use.
3. Replace runtime EDITMODE wildcard regex with a forward-only marker scan, preserving complete-block behavior and leaving unmatched blocks unchanged.
4. Add hostile/malformed HTML, entities, text boundaries, nested/unfinished raw-text, and repeated marker regressions; run tests/types/lint/build and normal commit/push hooks.
5. Push only feat/web-search-sources and reply to the existing review. Verify remote CI/CodeQL results, do not dismiss or suppress alerts to make the check green.

## Dependency candidates
- parse5 8.0.1: MIT, 337,099 unpacked bytes, entities ^8.0.0; maintained HTML5 tree parser with shipped types.
- parse5 6.0.1 already transitive: MIT, 331,125 unpacked bytes, no runtime deps, but older CJS/untyped API; prefer current ESM/types rather than pinning an old dev-transitive parser.
- Existing shared HTML helpers use lightweight string scans but are not a complete HTML5 parser; no regexp or browser execution as a security substitute.

## Outcome
- Installed direct parse5 8.0.1 (MIT, 337,099 unpacked bytes); lock selected entities 8.1.0 (BSD-2-Clause, 330,191 bytes). Both license files inspected. Total 667,290 bytes (~652 KiB), no unrelated lockfile changes. Built main output retains dynamic import('parse5'). Public dependency claims corrected.
- Added 14 HTML/network regressions and 10 runtime marker regressions. Focused desktop run: 72 pass; runtime: 94 pass. Full pre-push: 3,281 Vitest tests + 61 scripts pass, 4 skips; types/lint and desktop build pass.
- Committed and normally pushed e05f8dd287c327739af1a30fa6919375fecc6bec to the existing PR branch.
- Remote CI, Dependency Review, CodeQL and Linux packaging smoke passed. CodeQL check 106182426238 has conclusion success, 0 annotations, title 'No new alerts in code changed by this pull request'. No alert suppressions/dismissals.
- PR/Issue dependency documentation updated; summary reply https://github.com/OpenCoworkAI/open-codesign/pull/433#issuecomment-5754123595. Draft status unchanged; no human approval claimed.
