---
schemaVersion: 1
name: empty-states
description: >
  Designs empty-state screens for the three categories that matter:
  first-use (no records yet), no-results (filter/search returned nothing),
  and error (network/server failure). Use when a list, table, dashboard,
  or search surface might render with zero items, and to replace any
  generic "No data" placeholder.
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## When to use

Trigger this skill any time a UI surface can render with zero items:

- Lists, tables, kanban boards, inbox views.
- Search and filter result panes.
- Dashboards and analytics widgets that depend on data.
- Notifications, activity feeds, comments threads.
- Any screen where a network or query failure is possible.

## Rules

There are exactly three empty-state categories. Each has its own copy pattern. Do not collapse them into a single component.

1. **First-use (the user has not created their first record yet).**
   - One sentence explaining what this feature does.
   - One primary CTA — the action that creates the first record.
   - An illustrative graphic that hints at the artifact (a stylized invoice, a chart, a chat bubble), not a generic clipboard or magnifying glass.

2. **No-results (the user filtered or searched and nothing matched).**
   - Reframe the query: `No tickets matched "urgnet"`. Always quote the actual query.
   - Offer two of: clear-filter, broaden-search, suggest-spelling, recent-results.
   - Never show the same illustration as first-use — users will think their data was lost.

3. **Error (the request failed).**
   - Name the cause in plain language: `Network unreachable`, `Server returned 500`.
   - Primary CTA: Retry.
   - Secondary link: Report this problem (or open a debug detail panel).
   - Never show a stack trace as the entire screen.

4. **Stats placeholder.** When a stat tile has no data yet, render an em dash (`—`), not `0`. `0` is a real value (zero sales today); `—` means "no data".

5. **Never ship a screen that says only "No data" or "Nothing here yet".** Every empty state must answer "what do I do next?".

## Do / Don't

**Do**
- Quote the user's query verbatim in no-results messages.
- Use distinct illustrations per category so users can visually distinguish "first time" from "no match".
- Provide a Retry button in error states with optimistic UI on retry.
- Localize empty-state copy alongside the rest of the strings catalog.

**Don't**
- Don't reuse the first-use illustration for no-results.
- Don't show `0` in a stat tile that has never received data.
- Don't show technical error codes alone (`Error 500`); pair with human-readable cause.
- Don't hide the empty state behind a spinner that never resolves.

## Code patterns

First-use:

```tsx
<div className="grid place-items-center gap-4 py-16 text-center">
  <InvoiceIllustration className="w-32 h-32 opacity-80" />
  <p className="max-w-sm text-sm text-muted-foreground">
    Invoices you create will appear here. Send your first one to get paid.
  </p>
  <button className="h-11 px-4 rounded-md bg-blue-600 text-white">
    Create invoice
  </button>
</div>
```

No-results:

```tsx
<div className="grid place-items-center gap-3 py-12 text-center">
  <SearchIllustration className="w-24 h-24 opacity-70" />
  <p className="text-sm">No tickets matched <strong>"{query}"</strong>.</p>
  <div className="flex gap-2">
    <button onClick={clearFilters} className="h-9 px-3 text-sm rounded border">Clear filters</button>
    <button onClick={broaden} className="h-9 px-3 text-sm rounded border">Search all projects</button>
  </div>
</div>
```

Error:

```tsx
<div className="grid place-items-center gap-3 py-12 text-center">
  <AlertIllustration className="w-24 h-24 text-red-500" />
  <p className="text-sm">Network unreachable. Check your connection and try again.</p>
  <button onClick={retry} className="h-10 px-4 rounded bg-blue-600 text-white">Retry</button>
  <a href="/support" className="text-xs underline text-muted-foreground">Report this problem</a>
</div>
```

Stats placeholder:

```tsx
<dd className="text-2xl font-semibold">{value ?? '—'}</dd>
```
