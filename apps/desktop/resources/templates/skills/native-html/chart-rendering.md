---
schemaVersion: 1
name: chart-rendering
description: >
  Renders native SVG or canvas chart markup for dashboards, analytics, reports,
  case studies, metrics, graphs, plots, visualizations, 数据看板, or 图表.
  Use before writing any chart-shaped UI.
aliases: [charts, data-viz, dataviz, dashboard-charts, 图表, 数据可视化]
dependencies: [artifact-composition]
validationHints:
  - final artifact contains real svg or canvas marks
  - chart has data points labels units and interpretation text
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
license: MIT
authors: [open-codesign]
---

## Chart Contract

Every chart-shaped section must render real SVG or canvas marks with numeric
data. A title, labels, and a placeholder rectangle are not enough.

Choose one:

- Inline SVG for static charts up to roughly 30 points; retain marks in the
  authored HTML so useful chart content exists before scripts run.
- Authored plain JavaScript with canvas for interaction or denser data. Include
  a static accessible data summary/table and semantic chart caption in HTML.

Native mode does not automatically load chart libraries. Do not request a React
chart skill or replace the static document body with a script-mounted app.

Required elements:

- At least 6 data points for bars/lines, or 3 slices for donuts.
- Axis/category labels and a subtitle naming units/time range.
- Deliberate palette, never default tutorial colors.
- Tooltip or accessible title/aria-label for interactive marks.
- Color plus shape/dash/pattern when comparison must survive grayscale.

Use lines/areas for time trends, bars for categories, donuts only for 2-4
part-to-whole slices, scatter for correlation, and sparklines for KPI cards.

## Data Shape

Write the dataset before drawing the chart. Each point should include a label and
the numeric fields the chart uses:

```js
const mrr = [
  { month: 'Aug', actual: 82, target: 78, churn: 4.1 },
  { month: 'Sep', actual: 88, target: 82, churn: 3.8 }
];
```

Rules:

- Use plausible uneven values, not perfectly smooth diagonals.
- Include units in labels or captions: USD, %, ms, users, tickets, hours.
- For dashboards, pair the chart with a tiny interpretation line: what changed,
  why it matters, or what action follows.
- For case studies, pair charts with before/after framing and a timeframe.

## Rendering Requirements

- SVG charts must draw real `<path>`, `<rect>`, `<circle>`, `<line>`, or `<text>`
  elements derived from data.
- Canvas charts must initialize from data and draw marks on the canvas; do not
  use a canvas as a blank decorative box. Preserve a readable HTML fallback.
- Keep named series, accessible labels, and custom palettes tied to the dataset.
- Do not fake a chart with CSS gradients, background images, screenshot-like
  placeholders, or static axis labels over an empty panel.
- Do not leave "Chart goes here", "Loading chart", or gray skeleton rectangles in
  the final artifact unless the explicit task is a loading state.

## Polish

- Align numerals with `font-variant-numeric: tabular-nums`.
- Use gridlines sparingly; keep the data marks visually dominant.
- Make hover/focus states reveal a value, series, and label where interaction exists.
- Label the latest/highest/lowest point when it helps comprehension.
- Keep legends close to the chart and avoid color-only legends for comparisons.

Source: Open CoDesign's built-in chart-rendering methodology, adapted for native
HTML authoring. Copyright Open CoDesign contributors. MIT.
