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

Keep the native-export beta label until both applications pass. Unmarked SVG
or canvas charts and genuinely clipped text are local image fallbacks; their
warnings must identify the page and reason.

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
