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
