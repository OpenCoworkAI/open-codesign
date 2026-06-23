/**
 * Self-Critique Prompt for Open CoDesign
 * Checklist for self-review before calling 'done'
 */

export const SELF_CRITIQUE_PROMPT = `
Before calling 'done', review your work against this checklist:

<self_review>
## Visual Design
□ Typography: Is hierarchy clear? Sizes appropriate? Line-height comfortable (1.6+)?
□ Color: Purposeful use? Sufficient contrast (4.5:1 for text)? Accessible combinations?
□ Spacing: Consistent rhythm (8px grid)? Not too cramped? Not too sparse?
□ Alignment: Does everything line up properly? No random offsets?
□ Visual hierarchy: Is the most important content clearly the most prominent?

## Code Quality
□ HTML: Semantic elements (<header>, <main>, <nav>)? Proper nesting? No unnecessary divs?
□ CSS: Well-organized? Design tokens used (CSS custom properties)? No magic numbers?
□ Classes: Descriptive names? Consistent naming convention? Not too specific?
□ Comments: Only where needed (explain WHY, not WHAT)? Not excessive?
□ Structure: Logical order? Easy to maintain? No duplication?

## Functionality
□ Interactive elements: Do all buttons/links have hover states? Focus states? Active states?
□ Forms: Do all inputs have labels? Validation feedback? Error states?
□ Links: Are they clearly styled? Distinguishable from text? Visited state if relevant?
□ Buttons: Clear affordance? Disabled state if applicable? Loading state?
□ State management: Are all states covered (default, hover, focus, active, disabled, loading, error)?

## Accessibility
□ Heading hierarchy: Does h1→h2→h3 follow logical order? Only one h1?
□ Alt text: Do all images have descriptive alt attributes? Decorative images marked with alt=""?
□ Focus indicators: Visible focus outline on all interactive elements? Not removed with outline:none?
□ Keyboard navigation: Can you reach everything with Tab? Logical tab order?
□ Color contrast: Does all text meet WCAG AA (4.5:1, or 3:1 for large text)?
□ Form labels: Do all inputs have associated <label> elements? Not just placeholders?
□ Landmarks: Are semantic regions used (<header>, <nav>, <main>, <footer>)?
□ ARIA: Are ARIA attributes used correctly where needed? Not overused?

## Responsiveness
□ Mobile (375px): Does it work? Content readable? Touch targets ≥44×44px?
□ Tablet (768px): Does layout adapt gracefully? Nothing broken?
□ Desktop (1440px): Does it use space well? Not too stretched? Max-width set?
□ Touch targets: Are all interactive elements large enough on mobile (44×44px minimum)?
□ Images: Do they scale properly? No distortion? Responsive sizes?
□ Text: Does it wrap properly at all widths? No overflow?

## Edge Cases
□ Long text: Does it wrap properly? Doesn't break layout? Ellipsis if needed?
□ Empty states: Are they handled? Helpful message shown? Clear next action?
□ Loading: Is there a loading indicator? Skeleton or spinner? Doesn't block UX?
□ Error: Clear error message? Recovery action provided? User isn't stuck?
□ No content: What shows when there's no data? Is it helpful?

## Design System Consistency
□ Colors: All from design system tokens? No hardcoded hex values?
□ Typography: Using defined scales? Consistent font families?
□ Spacing: Following rhythm (8px multiples typically)? Consistent patterns?
□ Components: Using established patterns? Not reinventing existing components?
□ Tokens: Are CSS custom properties used (var(--color-primary))?

## Performance
□ Images: Lazy loading below the fold? Proper alt text? Reasonable sizes?
□ CSS: No excessive specificity? Minimal nesting? Organized?
□ JavaScript: No console.log statements? No memory leaks? Efficient?
□ File size: Reasonable for a single HTML file? Not bloated?

If ANY item is unchecked, FIX IT before marking done.
Only call the 'done' tool when ALL checks pass.
</self_review>
`;

/**
 * Quick self-check for simpler tasks
 */
export const QUICK_SELF_CHECK = `
Quick self-check before done:

✓ Meets user requirements?
✓ Uses design system tokens?
✓ Accessible (contrast, labels, keyboard)?
✓ Responsive (mobile to desktop)?
✓ All states included (hover, focus, active)?
✓ Edge cases handled (empty, loading, error)?

All ✓? Good to go. Any ✗? Fix first.
`;

/**
 * Generate task-specific checklist
 */
export function buildTaskSpecificChecklist(taskType: string): string {
  const baseChecklist = SELF_CRITIQUE_PROMPT;

  const additionalChecks: Record<string, string> = {
    form: `
## Form-Specific Checks
□ All inputs have visible labels (not just placeholders)?
□ Validation triggers on blur, not on every keystroke?
□ Error messages are specific and actionable?
□ Required fields are marked clearly?
□ Submit button disabled until form valid?
□ Success state shows clear confirmation?
`,
    ecommerce: `
## E-commerce-Specific Checks
□ Product images are prominent and well-sized?
□ Price is immediately visible and large?
□ Add to cart button is obvious and high-contrast?
□ Trust signals present (reviews, ratings, badges)?
□ Out of stock state handled properly?
□ Cart functionality works (add/remove/update)?
`,
    dashboard: `
## Dashboard-Specific Checks
□ KPIs are prominent with clear labels?
□ Data visualization is appropriate for data type?
□ Charts have axis labels and legends?
□ Tables are sortable and paginated?
□ Filters are accessible and show current state?
□ Empty states suggest actions?
`,
    mobile_app: `
## Mobile App-Specific Checks
□ All touch targets are ≥44×44px?
□ Bottom navigation is reachable with thumb?
□ Status bar and home indicator are present?
□ Pull-to-refresh implemented where appropriate?
□ Swipe gestures work as expected?
□ Fits in phone frame accurately?
`
  };

  return baseChecklist + (additionalChecks[taskType] || '');
}
