## Problem / pain point

When a user asks for an industry or market slide deck with recent data, they currently have to collect the facts and links themselves and put them all into the prompt. The design agent needs a bounded way to search, read originals, and retain the relationship between facts, sources, and pages.

The desired deliverables are a slide deck and a separate sources document. Source footers, citation numbers, chart source captions, and a references slide should not be added by default; years, units, statistical scope, and forecast labels must still remain when meaningful.

## Proposed solution

An opt-in Web Search v1 using the existing native pi tool/run architecture:

- One Tavily search adapter with normalized stable source IDs and nullable metadata, plus bounded public HTTP(S) page reading.
- Native `web_search` and `web_fetch`, using main-process credentials, existing structured-question consent, cancellation, timeouts, per-run budgets, response limits, and DNS-pinned public-address checks on every redirect.
- Workspace-local, schema-versioned source/evidence/page-usage records. Save sources during retrieval; validate evidence references and exact quotations before use.
- Stable `data-slide-id` associations and rendered semantic snapshots so source files follow the current page order and explicitly flag stale content rather than attributing old evidence to new claims.
- Deterministic independent Markdown sources from saved records, available next to normal exports and inside ZIP exports. Reuse the existing preview/export runtime and UI, without a research panel.

I have a working implementation to propose as a **draft** for architecture/scope review. It is larger than the suggested small-PR budget, so feedback on splitting the implementation is welcome before it is considered merge-ready. A separate supporting commit prevents an unreadable optional credential from blocking app startup.

## Alternatives considered

- Manual link collection in every prompt: does not solve the user workflow.
- Asking the model to reconstruct sources after creating the deck: risks invented URLs/quotations and loses provenance.
- A full MCP framework, multi-agent research loop, or multiple search providers: unnecessary for this first version.
- Inline slide citations by default: not the desired presentation output; keep the supporting document separate unless explicitly requested.

## Scope

Generation capability and export. One lazy HTML5 parser dependency (`parse5`, MIT, with the BSD-2-Clause `entities` decoder) replaces regex stripping following security review; no bundled model/browser runtime, hosted account, telemetry, or database tables. No PDF reader, browser-based web research, automatic academic citation formatting, cross-workspace knowledge base, or deep-research system in v1.

## Hard-constraints check

- [x] Reviewed the project hard constraints. The proposal is BYOK, local-first, reuses pi tools/events and existing export primitives, and keeps heavy rendering lazy-loaded.

## Validation boundary

Automated validation covers mock network integration, real system-browser rendering, and real source/ZIP output. A local tester also reports successful Tavily search and basic slide usage. This is not a claim of comprehensive live-provider or autonomous live-model end-to-end validation.
