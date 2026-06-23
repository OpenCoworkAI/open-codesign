/**
 * Chain-of-Thought Prompting for Open CoDesign
 * Encourages systematic planning before implementation
 */

export function buildChainOfThoughtPrompt(userRequest: string): string {
  return `
Before you start coding, think through the design systematically:

<design_thinking>
## 1. Requirements Analysis
- What is the user actually asking for?
- What's the primary use case?
- Who is the target audience?
- What content needs to be displayed?
- Are there any specific constraints or requirements?

## 2. Design System Mapping
From the active DESIGN.md, identify:
- **Colors:** Which tokens will you use? (primary, secondary, accent, neutrals)
- **Typography:** Which scale levels? (display, heading, body, caption)
- **Spacing:** What rhythm values? (typically 8px base: 8, 16, 24, 32, 48, 64)
- **Components:** Which patterns from the system apply here?

## 3. Layout Strategy
- **Information hierarchy:** What's most important → least important?
- **Grid structure:** How many columns? What breakpoints?
- **Content flow:** What's the logical reading order?
- **Responsive behavior:** How does it adapt from mobile → desktop?

## 4. Component Breakdown
List the major sections and components:
- **Header:** What elements? (logo, navigation, actions)
- **Main sections:** What are they? (hero, features, content, etc.)
- **Footer:** What's included? (links, copyright, newsletter, social)
- **Interactive elements:** What buttons, forms, or controls?

## 5. Accessibility Plan
How will you ensure WCAG AA compliance?
- **Semantic structure:** Which landmarks? (header, nav, main, aside, footer)
- **Heading hierarchy:** How will h1→h2→h3 flow logically?
- **Keyboard navigation:** What's the tab order? Any keyboard shortcuts?
- **Screen reader:** Where do you need ARIA labels? Live regions?
- **Color contrast:** Which text/background combinations? (check 4.5:1 ratio)

## 6. Edge Cases & States
Plan for non-ideal scenarios:
- **Empty states:** No content yet - what message? What CTA?
- **Loading states:** What skeleton/spinner? Where?
- **Error states:** What can fail? What messages and recovery actions?
- **Long content:** How handle overflow? Truncation? Pagination?
- **Disabled states:** What becomes non-interactive? How indicate?
</design_thinking>

Now implement the design following this plan.

User request: ${userRequest}
`;
}

/**
 * Alternative: Simpler chain-of-thought for quicker tasks
 */
export function buildSimpleThinkingPrompt(userRequest: string): string {
  return `
Think through these key questions before coding:

1. **Layout:** What's the overall structure? (header, main sections, footer)
2. **Hierarchy:** What's most important on the page?
3. **Responsive:** How does it adapt from mobile to desktop?
4. **Interactions:** What's clickable/interactive?
5. **States:** What different states exist? (default, hover, active, disabled, loading, error)

User request: ${userRequest}
`;
}

/**
 * Post-generation reflection prompt
 */
export const DESIGN_REFLECTION_PROMPT = `
After generating the design, reflect:

Did you:
- Follow the user's requirements precisely?
- Use design system tokens consistently?
- Create a clear visual hierarchy?
- Handle responsive breakpoints properly?
- Include all necessary interactive states?
- Meet accessibility standards?
- Handle edge cases (empty, loading, error)?

If anything is missing or could be improved, note it before marking done.
`;
