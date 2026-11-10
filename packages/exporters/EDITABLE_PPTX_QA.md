# Editable PPTX quality acceptance

The native exporter is still beta until the same generated fixture has been
opened, edited, saved, and reopened successfully in both PowerPoint and WPS.

## Generate the fixture

From the repository root, choose a directory outside tracked source and run:

```powershell
$env:CODESIGN_PPTX_QA_DIR = (Join-Path (Get-Location) '.Codex/workspace/pptx-qa')
pnpm --filter @open-codesign/exporters exec vitest run src/pptx-native.browser.test.ts -t 'four-page quality'
```

The test writes `quality-fixture.html` and `quality-fixture.pptx` in that
directory. It also checks the four slide parts, editable text and table, all
three native charts with data series and flat categories, no duplicate chart
SVG text. The full exporter test suite also checks package relationships.
Clear `CODESIGN_PPTX_QA_DIR` after the run.

## Visual review

Render each HTML `.slide` and each PPTX slide at 1280×720. Compare pages in
order, with special attention to text edges, line wraps, cropped pictures,
table bounds, chart bounds, overlap order, and any warning returned by export.
Record every visible difference with page number and the affected object.
Visual comparison locates problems; passing it does not replace the package
checks above.

## PowerPoint and WPS acceptance

For each application, record its product version and run these steps on a copy
of `quality-fixture.pptx`:

1. Open the deck without a repair prompt. Confirm four pages and no missing,
   repeated, overflowing, or badly misplaced content.
2. Edit the Chinese heading on page 1, one list item and one table cell on
   page 2, and a chart data value on each of pages 3 and 4.
3. Save, close, and reopen the deck. Confirm all changes persisted, and text,
   table, pictures, and charts remain independently editable.
4. Record the application version, date, screenshots or observations, and
   pass/fail for each step.

Keep the native-export beta label until both applications pass. Supported SVG
rectangles, ellipses, straight lines, groups, and text export as editable drawing
objects. These do not have chart data series; `data-pptx-chart` is required for
data charts, with optional `barDirection: 'horizontal'` for horizontal bars.
Unsupported SVG effects, paths, canvas charts, and genuinely clipped text still
use local image fallbacks; their warnings identify the page and reason.

## Recorded run: 2026-10-21

Exporter verification used Node 22.23.3 and pnpm 10.33.4: 212 tests passed,
8 were skipped, and TypeScript and Biome checks passed.

| Application | Version | Result |
| --- | --- | --- |
| Microsoft PowerPoint | 16.0.17932.21000 | Passed through COM: opened four pages; edited heading, list item, table cell, and all three chart series; saved and reopened with changed values and editable objects. No repair error was reported. |
| WPS Presentation | Not installed on the test machine | Pending. |

Source HTML and PowerPoint PNGs were reviewed page by page at 1280×720. No
content overflow or missing objects was found, including the inset-clipped
picture on page 1. Native charts add grid lines,
tick labels, and their own spacing; the chart restyling warning reports this.
The generated sample and screenshots live in the ignored
`.Codex/workspace/pptx-qa/` directory of the test worktree.

## Real-deck regression: 2026-10-22

A six-page user deck with vertical sales bars and horizontal penetration bars
had only `data-research-values` annotations. The original export rasterized
both SVGs. Re-exporting the unchanged JSX now preserves bars, grid lines,
numeric labels, years, units, and the 50% threshold as native shapes/text.
Pages 3 and 4 each have two remaining decoration pictures; neither chart is a
picture. PowerPoint 16.0.17932.21000 rendered both pages, edited a chart label
and bar fill, saved, and reopened with both edits retained. Source/PPTX PNGs
were compared for layout. No user source or data was changed.

The reproduction files and report remain local in the ignored
`.Codex/workspace/ev-chart-qa/` directory. The research and general slide
generation prompts now request the data-chart contract explicitly rather
than relying only on an optional chart skill.

## Desktop UI generation/export run: 2026-10-22

Computer Use submitted a natural-language request to the configured CoDesign
model for six Chinese slides containing grouped columns, horizontal bars,
two-series lines, a pie chart, a revenue table, and nested lists. All numbers
were specified synthetic test data. The resulting `App.jsx` was generated and
self-previewed by CoDesign; no hand-written replacement deck was used.

The editable PPTX menu initially exported only the cover because React mounted
one slide at a time. Numbered page navigation is now followed during native
export, with a duplicate-page failure guard. Ordinary nonuniform cell borders
also remained rasterized; separate solid top/right/bottom/left borders now
produce a native table. Both fixes have browser regressions, and table borders
have an OOXML writer check.

After rebuilding and re-exporting through the desktop UI, package inspection
confirmed six pages, four native charts with six total series and the exact
requested values/categories, and one native table. Remaining pictures are
local decorations. PowerPoint 16.0.17932.21000 opened the deck without a repair
prompt, exposed the column chart's embedded data worksheet with correct values,
saved, and reopened the six-page deck. This run did not complete chart-data
mutation: Computer Use could not target the embedded Excel child window.

Visual acceptance **failed**: default native-chart colors differ from source
legend colors, chart legends duplicate existing DOM legends, horizontal chart
categories are reversed, and the source donut becomes a pie. Some custom list
markers duplicate native bullets, and cover KPI unit placement needs work.
The source-generated preview also emitted a recoverable invalid-preview-tool
argument error and attempted a missing sources file before writing it.
These observations remain follow-up work; neither full PowerPoint editing
acceptance nor WPS acceptance is claimed, and the beta label stays in place.

The source snapshot, PowerPoint-saved PPTX, package relationship checks, and
observations are kept in the ignored `.Codex/workspace/ui-chart-qa/` directory.

### UI follow-up: chart styling and editing

CoDesign updated the same generated JSX through a follow-up UI prompt to retain
the source palette in `colors`, suppress native legends where DOM legends
already exist, enable value labels, and declare the donut's `holeSize: 52`.
These are optional validated chart-contract fields. Native horizontal bars now
keep source category order, and `list-style:none` no longer adds native bullets.
The default slide-generation prompt and chart skill now request matching palette,
legend, label, and donut metadata; prompt contract/budget tests pass (15 tests).

A subsequent export through the actual desktop editable-PPTX menu contains six
pages, four charts/six series, and one native table, with no missing package
relationships. PowerPoint 16.0.17932.21000 visually confirmed matching series
colors, one legend, correct horizontal category order, an editable doughnut,
and no duplicate native list markers. Source numbers/categories are retained.
Native axis placement, grid lines, and spacing still differ from SVG styling.

Computer Use opened the native table, changed Q1 domestic revenue from 120 to
125, saved a separate copy, closed it, and reopened it. Both PowerPoint and the
saved table XML retain 125. The chart-data worksheet can be targeted using
**Edit Data → Edit Data in Excel**, which opens a full Excel window; this avoids
the unaddressable embedded child window from the initial run. A separate chart
copy was changed from 120 to 125 and saved, with the changed chart cache verified.
The styled table-editing copy was subsequently used for a combined check: the
page 2 heading became `原生文字与图表编辑验证（已修改）`, and the embedded column
chart's B2 value became 125. PowerPoint updated both the column and its label.
Saved OOXML retains the changed heading, table cell, and chart value, with their
native object types intact.
After closing and reopening this combined copy, PowerPoint still displays the
changed heading and 125 chart label, and its chart context menu still offers
Edit Data. No repair prompt appeared.

Full exporter verification passed 227 tests with 8 skipped. Review then caught
one additional dynamic-page signature case: identical content with only root
class/style changes. A failing browser regression reproduced it; the signature
now includes real root attributes and excludes exporter-injected attributes.
The focused navigation regressions and TypeScript check pass.

The cover overlap was traced to the generated source: `.cover__main` has
`flex:1` with zero bottom padding, placing the KPI row under its absolutely
positioned footer. CoDesign's full preview at 70% reproduces footer text across
the first KPI before export. Extracted cover pictures contain only decorations,
and the requested Noto font is installed. A UI follow-up asks CoDesign to reserve
100px of footer space. WPS is not installed; keep the beta label until all visual
and cross-application checks pass.

CoDesign completed the padding change through its UI. Measured source geometry
now leaves 35.6px between KPI content and footer. After rebuilding/restarting the
desktop app, Computer Use window activation timed out twice despite a responsive
app process. The final source was therefore exported through the same native
exporter directly, with six pages, four charts, one table, and valid relationships.
This last invocation is **not** counted as another UI export run. PowerPoint was
opened on the final file, but its screenshot capture also timed out; final visual
reinspection remains pending. The earlier styled UI export and combined editing
roundtrip were visually verified before the control-tool failures.
