---
schemaVersion: 1
name: loading-skeleton
description: >
  Decides when to use skeleton loaders vs spinners vs progressive rendering,
  and shapes the skeleton to match the real content geometry. Use when
  loading async content into a list, card grid, table, dashboard, or any
  surface where perceived performance matters.
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## When to use

Trigger this skill when designing or implementing any async loading state:

- Lists, tables, card grids waiting on a fetch.
- Dashboards waiting on multiple parallel queries.
- Detail panes waiting on a record fetch.
- Image grids, avatars, charts, and any element with predictable geometry.

## Rules

1. **Use a skeleton only when content shape is predictable.** If you know the loaded result will be a card with a title and three lines of body, render a skeleton with one short bar + three long bars. If you don't know the shape (variable count of search results, unknown chart type), use a small inline spinner with a label instead.
2. **Match real element geometry.** The skeleton bar width should approximate the real text width band — a name field is ~120 px, an email is ~200 px. Don't fill the entire container width with a single bar; that signals "long paragraph" and is jarring when the real content is "John".
3. **Render progressively.** Show text fields as soon as their data resolves. Variable-shape elements (images, charts, videos) can stay skeleton until they load. Don't wait for everything before showing anything.
4. **Use spinners for unpredictable shapes.** Search "did you mean" panels, dynamic chart types, and unknown-count results are better served by a small inline spinner with a `Loading…` label than a guess at the wrong skeleton shape.
5. **Time-out at 10–30 s.** Switch to an error state with a Retry CTA. Never spin forever — the user thinks the app froze.
6. **Never use a full-screen spinner.** Reserve full-screen loading only for hard navigation (login → app shell). For in-app data fetches, keep the surrounding chrome rendered and skeleton only the changing region.

## Do / Don't

**Do**
- Animate the skeleton with a subtle shimmer or pulse (no faster than 1.5 s per cycle).
- Match the corner radius of the real element (avatar = `rounded-full`, card = `rounded-lg`).
- Reserve vertical space so the layout doesn't jump when real content arrives.
- Show count-based skeletons (3–5 placeholder rows) so the page feels populated.

**Don't**
- Don't render skeleton blocks the full container width when real text is short.
- Don't combine skeleton and spinner in the same region — pick one.
- Don't leave a spinner running with no timeout.
- Don't hide existing data behind a skeleton on refresh — keep showing the stale data with a small refresh indicator.

## Code patterns

Card skeleton matched to real geometry:

```tsx
function CardSkeleton() {
  return (
    <div className="p-4 rounded-lg border grid gap-3 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-muted" />
        <div className="grid gap-1.5">
          <div className="h-3 w-24 rounded bg-muted" />
          <div className="h-2.5 w-16 rounded bg-muted" />
        </div>
      </div>
      <div className="grid gap-1.5">
        <div className="h-2.5 w-full rounded bg-muted" />
        <div className="h-2.5 w-11/12 rounded bg-muted" />
        <div className="h-2.5 w-2/3 rounded bg-muted" />
      </div>
    </div>
  );
}
```

Inline spinner for unpredictable shape:

```tsx
<div className="flex items-center gap-2 text-sm text-muted-foreground">
  <Spinner className="w-4 h-4" />
  <span>Searching…</span>
</div>
```

Progressive render with timeout:

```tsx
const { data, error, isLoading } = useQuery({
  queryKey: ['tickets'],
  queryFn: fetchTickets,
  staleTime: 30_000,
  retry: 2,
});

if (error) return <ErrorState onRetry={refetch} />;
if (isLoading) return <ListSkeleton rows={5} />;
return <TicketList items={data} />;
```
