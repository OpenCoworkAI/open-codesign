# Chart rendering contract

When the artifact is a dashboard, analytics view, report, case study with metrics, or any artifact requesting "chart", "graph", "plot", "visualization", or "数据看板" / "图表":

## Render real markup, not labels
Every chart-shaped section MUST emit `<svg>`, `<canvas>`, or a mounted React chart with actual numeric data. Outputting only the section header, a list of category names ("A B C D E F"), or placeholder text ("Chart goes here", "[chart]") is a hard failure.

## Rendering choice (pick ONE per artifact)
- **Inline SVG** — preferred for static charts up to ~30 data points. Hand-code paths, axes, gridlines, labels. No external script needed.
- **Chart.js** — preferred for interactive charts with hover/animation. Load it from the project's approved cdnjs whitelist (see "Permitted external resources" in output rules) and pin an exact version. Use one `<canvas>` per chart.
- **Recharts (React only)** — preferred when the artifact is React. Load it from the same cdnjs whitelist with a pinned version. For Recharts-specific styling, defer to the `data-viz-recharts` skill — do not duplicate its guidance here.

Do not invent new CDN hosts. The output-rules whitelist is the single source of truth; if a library is not on it, hand-code an inline SVG instead.

## Pick the right chart type
- **Trend over time** — line chart (single series) or area chart with `fillOpacity ≈ 0.15` (multi-series). Never a bar chart for > 8 time buckets.
- **Comparison across categories** — vertical bar chart for ≤ 8 categories, horizontal bar chart when labels are long or count > 8.
- **Part-to-whole** — donut for 2–4 segments with a centered total. Never a pie chart with > 4 slices; switch to horizontal bars.
- **Correlation** — scatter plot with domain-appropriate dot size, opacity ≈ 0.7 to show density.
- **Single KPI trend** — sparkline (line, no axes) inside a stat card, paired with the absolute value and a delta pill.

## Mandatory chart elements
Every chart MUST include:
- Real numeric data (≥ 6 data points for bars/lines, ≥ 3 slices for donut)
- Axis labels — x-axis category names, y-axis scale with abbreviated large numbers (1.2M, 34K)
- A title above the chart and a one-line subtitle stating the unit / time range
- Encouraged: legend (only when ≥ 2 series), hover tooltip, subtle entry animation

## Color palette
- Pick a palette that matches the brief's tone (warm / cool / monochrome / accent-driven)
- For dark themes use oklch with high chroma — `oklch(70% 0.18 200)`, `oklch(75% 0.16 30)` — avoid muted grays
- Never use Chart.js or Recharts default palettes; they look like every tutorial chart
- Color must not be the only differentiator. Pair it with shape, dasharray, or pattern fill so the chart stays legible in grayscale and for color-blind viewers

## Hover and accessibility
- Tooltip on hover shows the exact value plus the category and unit; avoid generic "Series 1: 42"
- Add `aria-label` (or a `<title>` child for inline SVG) describing what the chart shows
- Keyboard focus styles on interactive marks; never rely on hover-only affordances

## Self-check
Before finalizing the artifact, scan it: does every chart-shaped section contain rendered markup with data, axis labels, a title, and a deliberate palette? If not, fix it.
