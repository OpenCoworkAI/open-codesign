# Web Search v1

Open CoDesign can research a slide topic, save facts/data, build slides, and deliver a separate sources file. It uses **Tavily Search** and a bounded, direct HTTP(S) reader. There is no research panel, MCP runtime, or hosted account. HTML reading uses the lazily loaded `parse5` HTML5 parser; it does not execute webpage scripts or load their resources.

## Configure

Finish normal model onboarding first. Close the app and add these sections to the active `config.toml` (normally `~/.config/open-codesign/config.toml`; respects `XDG_CONFIG_HOME` and custom storage locations):

```toml
[webSearch]
enabled = true
maxCalls = 12
timeoutMs = 15000
maxChars = 10000

[secrets.tavily]
ciphertext = "plain:YOUR_TAVILY_API_KEY"
```

Restart the app. Do not paste the key into chat or a design workspace. The `ciphertext` name is the existing credential-storage format; `plain:` is its supported human-readable local form. Existing `safe:` credentials are also handled by the main-process credential resolver. Provider settings and OAuth changes retain the search configuration.

If an older build fails to start with `Failed to decrypt a legacy API key`, an entry without `plain:` or `safe:` is being interpreted as legacy encrypted data. Check the entry you added: a newly copied Tavily key must be `ciphertext = "plain:tvly-..."`, not just `ciphertext = "tvly-..."`. Do not prefix existing encrypted values with `plain:`; replace them with a freshly copied key if needed. The log alone does not identify which entry failed. Credential migration now preserves unreadable entries and logs their provider ID without aborting startup; that credential still needs repair before use.

Search is disabled by default. Its first network call asks through the existing structured-question dialog for this run's bounded public-web access: choose **Allow this run** or **Deny**. Denial or cancellation prevents the request. Permission is not carried into later runs; this v1 does not persist a network allowlist. A missing Tavily key is an explicit search error, not an empty result or simulated success. Public webpage reading does not require a Tavily key. Search queries are sent to Tavily; page requests go directly to the requested public host. Credentials are never tool arguments or results.

If a tool reports **Web access is disabled**, the run loaded a missing or false `webSearch.enabled`; this is not an HTTP error from the target website. A Tavily key alone does not enable networking. Fully quit the app, check the active config directory shown in Settings (not a workspace config), add or update the top-level `[webSearch]` section above, then restart and start a new turn. Older builds could drop this section when saving provider/model, import, image or design-system settings; those save paths now preserve it, including an explicit `false`. If an older build already removed the section, it needs to be added again.

Settings limits: `maxCalls` 1–50 (search and fetch combined per run, including failed network attempts); `timeoutMs` 1,000–60,000; `maxChars` 1,000–12,000 (per fetched body). Search allows 1–5 results and at most 2,000 snippet characters per result. Each HTTP response is limited to 1 MiB, and page fetches allow at most five redirects. Records are limited to 8 MiB per workspace.

Adapter API: [official Tavily Search reference](https://docs.tavily.com/documentation/api-reference/endpoint/search). V1 uses `POST /search`, Bearer authentication, basic search, and no generated answer or raw-content response. The tool contract is provider-independent.

## Use

For example:

> 制作一份包含近期数据和一张数据图表的行业介绍 slides。保留年份、单位和预测标签，资料来源单独提供。

The model can call:

- `web_search(query, count?)`: normalized sources with stable URL-derived IDs, known metadata, and retrieval time; successful results are saved before return.
- `web_fetch(url)`: bounded readable HTML/plain text, final URL, MIME type and truncation status; saves the original excerpt.
- `research_records(offset?, id?)`: recover existing source/evidence summaries and slide usage, or retrieve a complete saved source/evidence record by ID without searching again. This is read-only: it does not create the research directory/file or rewrite existing records.
- `research_evidence(...)`: record a fact, calculation, forecast or inference before using it. Facts need an exact saved quote. Unknown references/locators and invented quotations are rejected. Calculations need saved inputs and a formula.
- `research_slide(path, slideId, evidenceIds)`: capture current rendered page content and replace its evidence association. An empty list clears usage.
- `research_export(path)`: generate a separate collision-safe `sources.md` from saved records in current page order.

Research is not mandatory for every slide task. The prompt instructs the model not to network when prohibited, not to search again for pure visual/reorder edits, to reuse existing evidence, and to report gaps or conflicting statistical definitions instead of fabricating numbers. The permission dialog is the host-enforced network gate; natural-language prohibitions also depend on model instruction following.

By default, slides have **no source footers, citation numbers, chart source captions or references page**. Users can explicitly request those. Years, geography, units, population/scope, and forecast labels are still meaningful slide content and must be retained where needed.

## Where the outputs are

- Slides remain ordinary workspace JSX/HTML, previewed and exported with existing controls.
- Structured records are in `.codesign/research.json` (`schemaVersion: 1`) and survive session/workspace reopening.
- `research_export` creates `sources.md` in the workspace, then `sources-1.md`, etc. if a file already exists. It never overwrites an existing sources file.
- Ordinary HTML/PDF/PPTX/Markdown exports regenerate a companion `<export-name>.sources.md` **beside the selected output**, using numbered suffixes on collision. The existing export notification includes its path.
- ZIP exports include a fresh `sources-<unique-suffix>.md` alongside the normal files. The name avoids collisions with existing user assets.

Research companions are optional for ordinary exports. If saved research is corrupt, a deck cannot be inspected, or writing the companion fails, the primary export is still saved and the existing export notification includes a sources warning. No companion path is reported when it was not written. An explicit `research_export` request still fails clearly when its sources cannot be generated; errors from the primary exporter also remain failures.

Only evidence actually registered to current pages (and calculation input evidence) contributes source links. Merely searched/unused links are excluded. Exports include current page numbers/titles, claims, saved excerpts, known metadata, scope, formulas, forecast/inference kinds and uncertainty flags. “Original read” is not a fact-checking certificate.

## Page identity and update rules

Researched slide roots use `section data-slide-id="stable-name"`. Each slide needs a unique ID unrelated to its position. JSX is rendered with the existing lazy export runtime; current DOM order determines page numbers. HTML decks work too.

Evidence is attached to a rendered semantic fingerprint (text, accessible data labels, image references and SVG geometry), not a page number. Reordering/deleting pages and changing colors/fonts preserves remaining associations. Changed semantic content is exported as an explicit **evidence gap**, without old citations, until the model updates evidence and relinks that slide. Every regenerated export checks this again. Previously downloaded Markdown files are snapshots and are not rewritten after later edits.

## Limits and validation

- One search provider; no automatic fallback or deep-research loop.
- HTML/plain text only. PDF, compressed responses, authenticated pages, JavaScript-only articles and nonstandard ports are unsupported. Charset-specific pages may require another source.
- HTTP(S) only, ports 80/443; no embedded credentials. Private/local/link-local/metadata and reserved IP ranges are blocked, including IPv4-mapped IPv6. All DNS answers are checked and the actual socket is pinned to a validated address. Every redirect is rechecked. There is no proxy or local-network bypass.
- Research slides require inspectable text/SVG charts, not canvas/iframe/video. Nested sections should not be used as layout containers. Every rendered section is treated as a page.
- Fingerprints are deliberately conservative: changing SVG geometry or an image URL can require relinking even if intended as a visual edit. Arbitrary CSS-generated content, external image contents changing at the same URL, or opaque visual-only data cannot be semantically verified. Expose chart values as text or accessible attributes.
- Uses an existing system Chrome/Chromium/Edge for rendered slide snapshots, like current exports. It does not bundle or download a browser.
- Source metadata remains null if unavailable. HTML extraction traverses parsed text nodes, omits non-content subtrees, and is not a full article reader. Returned text remains untrusted data (including literal angle brackets from encoded references), not sanitized HTML suitable for insertion. Exact quotes are checked against saved text, but the model still bears responsibility for interpretation, calculations and scope.
- Mock integration tests cover tool calls, persistence/recovery, real browser-rendered slides, Markdown and ZIP, reorder/style/deletion/stale-content checks, and network boundary tests. **Live Tavily and a live-model autonomous end-to-end run have not been verified in this implementation session.**

### Parser dependency

HTML5 parsing replaces ad-hoc regular-expression tag stripping, which can reconstruct markup from malformed input. `parse5` is imported only when an HTML page is read; plain-text reading and app startup do not load it. It is a direct production dependency rather than relying on an incidental development/transitive install, so packaged apps have it available.

- `parse5` 8.0.1: MIT, 337,099 registry-unpacked bytes.
- Locked transitive `entities` 8.1.0: BSD-2-Clause, 330,191 registry-unpacked bytes; compatible with Node 22.
- Combined registry-unpacked size: 667,290 bytes (about 652 KiB); this is not a measured installer delta.

Existing lightweight HTML string helpers are not a full HTML5 parser; using a browser would add execution/resource-loading risk to a read-only tool. A peer dependency would make the shipped reader unreliable when the user has not separately installed a parser.

Focused checks:

```sh
pnpm --filter @open-codesign/desktop exec vitest run src/main/web-research-network.test.ts src/main/web-research.test.ts src/main/exporter-ipc.test.ts
pnpm --filter @open-codesign/core exec vitest run src/tool-manifest.test.ts src/agent.test.ts
```
