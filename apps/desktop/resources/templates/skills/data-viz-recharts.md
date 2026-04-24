---
schemaVersion: 1
name: data-viz-recharts
description: >
  Guides data visualization design using Recharts. Use when building charts,
  dashboards, analytics views, or any data-driven UI with Recharts or
  comparable charting libraries. Enforces brand-consistent colors, readable
  axes, and accessible chart patterns.
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## Data Visualization with Recharts

### Color Palette
Never use Recharts default colors (`#8884d8`, `#82ca9d`, `#ffc658`). They look like every tutorial chart ever made. Define a custom palette as a const array and pass it to `<Cell fill={COLORS[index % COLORS.length]} />`.

Recommended starting palette (adjust to brand):
```js
const CHART_COLORS = [
  'oklch(55% 0.22 260)',  // brand primary
  'oklch(65% 0.18 30)',   // warm accent
  'oklch(60% 0.15 155)',  // success green
  'oklch(55% 0.20 350)',  // alert red
  'oklch(70% 0.10 260)',  // primary muted
];
```

### Chart Type Selection
- **Comparison over time**: `<AreaChart>` with `fillOpacity={0.15}` (not solid fill)
- **Part-to-whole (few categories)**: `<BarChart layout="vertical">` — never a pie chart with > 4 slices
- **Correlation**: `<ScatterChart>` with domain-appropriate dot size
- **Single KPI trend**: `<LineChart>` with a single series and a `<ReferenceLine>` for target

### Axes and Labels
Always show `<XAxis>` and `<YAxis>` with `tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }}`. Use `tickFormatter` to abbreviate large numbers (1.2M, 34K). Never show a chart without axis context — raw pixel positions are meaningless to users.

### Tooltip Design
Override `<Tooltip>` with a `content={<CustomTooltip />}` component. The default Recharts tooltip has poor contrast and generic styling. The custom tooltip should match the app's design system: rounded corners, subtle shadow, brand font.

### Grid and Borders
Use `<CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />` with low opacity. Remove the chart border (set `<ResponsiveContainer>` wrapper and no explicit border). Minimal grid lines reduce cognitive noise.

### Responsive Sizing
Always wrap in `<ResponsiveContainer width="100%" height={height}>`. Never hardcode pixel dimensions for the container. Choose height values: 200px (sparkline/compact), 300px (standard), 400px (detailed), 500px (focus chart).

### Accessibility
Add `aria-label` to the `<ResponsiveContainer>` describing the chart. Include a `<text>` summary for screen readers via an off-screen `<title>` element. Ensure color is never the only differentiator — use shape or pattern fills as a secondary signal.

### Animation
Disable Recharts default animation for dashboard charts that update frequently: `isAnimationActive={false}` on `<Line>`, `<Bar>`, `<Area>`. Use it only for initial load of report-style charts where the animation aids comprehension.
