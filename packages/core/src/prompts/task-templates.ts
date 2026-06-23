/**
 * Task-Specific Prompt Templates for Open CoDesign
 * Context-aware guidance for different design types
 */

export const TASK_TEMPLATES = {
  landing_page: `
## Landing Page Best Practices

- **Hero section:** Clear value proposition in <10 words, strong primary CTA, visual hierarchy
- **Structure:** Hero → Benefits → Social proof → Features → Pricing → FAQ → Footer
- **Copy:** Specific and benefit-focused, not generic marketing speak
- **Visual style:** Match brand identity, avoid stock photo aesthetics
- **Performance:** Optimize images, prioritize above-the-fold speed
- **CTA:** Single primary action per section, clear labels ("Start Free Trial" not "Click Here")
`,

  dashboard: `
## Dashboard Best Practices

- **Layout:** Clear navigation, KPI cards at top, data tables/charts below, filters accessible
- **Data visualization:** Choose right chart type, label axes clearly, show trends over time
- **Density:** Pack information efficiently but keep scannable, use whitespace strategically
- **Actions:** Primary actions visible, bulk operations supported where applicable
- **Empty states:** Helpful messages ("No data for selected period"), suggest action
- **Loading states:** Skeleton loaders for structure, not just spinners
- **Numbers:** Monospace/tabular numerals for alignment, consistent formatting
`,

  mobile_app: `
## Mobile App Best Practices

- **Touch targets:** Minimum 44×44px with generous padding (48×48px preferred)
- **Navigation:** Bottom tab bar (4-5 items) or hamburger menu, consistent placement
- **Typography:** Larger than web (16px minimum body), comfortable line-height
- **Scrolling:** Natural momentum, pull-to-refresh where appropriate
- **States:** Offline mode, loading skeletons, error recovery, empty states
- **Gestures:** Swipe, long-press where users expect (familiar patterns)
- **Frame:** iPhone 15 Pro accurate (Dynamic Island, status bar, home indicator)
`,

  form: `
## Form Best Practices

- **Labels:** Always visible above field, not just placeholders (accessibility)
- **Validation:** Inline on blur, clear error messages, don't validate on every keystroke
- **Structure:** Logical grouping, progress indicator for multi-step, single column on mobile
- **Accessibility:** Proper label association, error announcements, keyboard navigation
- **UX:** Save draft automatically, don't lose data on back, confirm before discard
- **Success:** Clear confirmation message, show what happens next
- **Input types:** Use proper HTML5 types (email, tel, number) for better mobile UX
`,

  ecommerce: `
## E-commerce Best Practices

- **Product cards:** Clear image, name, price (large), rating, quick add-to-cart
- **Filters:** Accessible sidebar, clear selected state, results count, easy reset
- **Trust signals:** Security badges, reviews, free shipping, return policy visible
- **Mobile:** 2 columns grid, larger touch targets, sticky add-to-cart bar
- **Performance:** Lazy load images, fast initial render, optimistic UI updates
- **Conversion:** Minimize friction, guest checkout, save cart, clear CTAs
`,

  blog: `
## Blog Article Best Practices

- **Typography:** 18-21px body text, 1.6-1.8 line-height, max 680px width (65-75 chars)
- **Hierarchy:** Clear heading levels (h1 for title, h2 for sections, h3 for subsections)
- **Table of Contents:** Auto-generated from headings, sticky on desktop, smooth scroll
- **Reading experience:** Serif font optional, generous margins, pull quotes for emphasis
- **Images:** Full-width or inset, captions below, alt text required, lazy loading
- **Related content:** 3-4 cards at bottom, same category or tags
`,

  admin: `
## Admin Dashboard Best Practices

- **Tables:** Sortable columns, row selection, bulk actions, pagination controls
- **CRUD:** Modal or slide-out panel for create/edit, confirmation for delete
- **Filters:** Persistent across navigation, clear applied state, easy reset
- **Search:** Debounced input, shows results count, highlights matches
- **Permissions:** Disable actions user can't perform, show why if needed
- **Audit trail:** Log important actions, show who/when for changes
`,

  presentation: `
## Presentation Slide Best Practices

- **Layout:** 16:9 aspect ratio, consistent margins, clear focal point
- **Typography:** Large readable text (24px+ body), high contrast, limited fonts
- **Visual hierarchy:** One main message per slide, supporting points smaller
- **Images:** Full-bleed or contained, never stretched, high quality
- **Animations:** Subtle reveals, no distracting transitions, progressive disclosure
- **Navigation:** Clear slide numbers, table of contents slide, next/prev controls
`
};

export type TaskType = keyof typeof TASK_TEMPLATES;

/**
 * Get task-specific guidance based on inferred or explicit task type
 */
export function getTaskTemplate(taskType: TaskType | string): string {
  if (taskType in TASK_TEMPLATES) {
    return TASK_TEMPLATES[taskType as TaskType];
  }
  return '';
}

/**
 * Infer task type from user prompt
 */
export function inferTaskType(prompt: string): TaskType | null {
  const lower = prompt.toLowerCase();

  if (lower.match(/landing|homepage|marketing page|hero/)) return 'landing_page';
  if (lower.match(/dashboard|analytics|metrics|kpi/)) return 'dashboard';
  if (lower.match(/mobile app|ios|android|phone screen/)) return 'mobile_app';
  if (lower.match(/form|input|signup|login|checkout/)) return 'form';
  if (lower.match(/shop|store|product|ecommerce|cart/)) return 'ecommerce';
  if (lower.match(/blog|article|post|editorial/)) return 'blog';
  if (lower.match(/admin|backend|management|cms/)) return 'admin';
  if (lower.match(/slide|deck|presentation|pitch/)) return 'presentation';

  return null;
}
