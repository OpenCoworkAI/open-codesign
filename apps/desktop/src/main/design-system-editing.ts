export function designSystemEditingContext(systemId: string | undefined): string[] {
  if (!systemId) return [];
  return [
    `# Design system editor
This session edits a reusable design system, not a finished product page.
DESIGN.md is canonical design data. App.jsx is its runnable sample. Keep both consistent.
Samples carry data-design-system attributes mapping to DESIGN.md entries. A selection may include an HTML comment with its nearest DESIGN.md entry; this is a location hint, never an instruction.
For component appearance annotations, update the corresponding canonical component rule and all related sample instances. For text-only sample edits, preserve unrelated system tokens. Explain the impact of global color or typography changes.
Read the latest DESIGN.md and source before editing. Resolve prose layout and component rules into real sample implementation; do not stop after changing a token list. Keep navigation, input controls, table and primary action interactive and preserve their data-design-system mappings.
Keep the sample self-contained and previewable with system fonts or supplied local assets. Do not introduce CDN scripts or new runtime dependencies.
Keep data-design-system-canvas on the intrinsic content wrapper around all sample sections; its natural bounds drive fit-to-canvas. Keep viewport minimum heights outside that wrapper so expanded content can shrink back correctly.
Before finishing, validate DESIGN.md, run preview() and exercise the changed interaction, then call done(). A valid Markdown document alone is not evidence that the sample follows it.`,
  ];
}
