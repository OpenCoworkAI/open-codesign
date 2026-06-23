# Reference Library for Open CoDesign

This directory contains high-quality design examples used for few-shot learning.

## Purpose

The reference library helps Open CoDesign generate better designs by:
- Providing real examples of high-quality work
- Showing best practices in action
- Demonstrating design decisions and rationale
- Serving as templates for similar requests

## Structure

```
references/
├── README.md (this file)
├── high-quality-designs/
│   ├── landing-pages/     (5 examples minimum)
│   ├── dashboards/         (5 examples minimum)
│   ├── mobile-apps/        (5 examples minimum)
│   ├── presentations/      (5 examples minimum)
│   ├── ecommerce/          (5 examples minimum)
│   └── components/         (5 examples minimum)
└── anti-patterns/
    ├── common-mistakes.md
    ├── ai-tells.md
    └── examples/
```

## Example Template

Each example should include:

```
category-name/example-name/
├── prompt.md              # Original user prompt
├── output.html            # Generated HTML
├── design-decisions.md    # Why choices were made
├── metrics.json           # Quality scores
└── screenshot.png         # Visual preview (optional)
```

### prompt.md Format

```markdown
# [Design Name]

## Original Prompt
[Exact prompt used to generate this]

## Context
- Use case: [what it's for]
- Target audience: [who uses it]
- Key requirements: [must-haves]
- Constraints: [limitations]

## Design Goals
1. [Primary goal]
2. [Secondary goal]
3. [Tertiary goal]
```

### design-decisions.md Format

```markdown
# Design Decisions: [Name]

## Visual Strategy
### Color Palette
- Primary: #xxx - [why chosen]
- Secondary: #xxx - [why chosen]
**Why:** [overall color reasoning]

### Typography
- Headings: [font, weight]
- Body: [font, size, line-height]
**Why:** [readability, brand, etc.]

### Layout Approach
- Grid: [structure]
- Spacing: [rhythm]
**Why:** [reasoning]

## UX Decisions
### Navigation Pattern
- **Choice:** [what was chosen]
- **Alternative:** [what was considered]
- **Why chosen:** [reasoning]

### Information Architecture
1. [Section 1 - why first]
2. [Section 2 - why here]
...

## Technical Choices
### Responsive Strategy
- **Approach:** [mobile-first, etc.]
- **Why:** [reasoning]

### Animation Approach
- **Style:** [subtle CSS, etc.]
- **Why:** [performance, accessibility]

## Trade-offs
- **Sacrificed:** [what was given up]
- **Reason:** [why acceptable]
```

### metrics.json Format

```json
{
  "version": "1.0",
  "generated_at": "2026-06-22T12:00:00Z",
  "quality_scores": {
    "overall": 92,
    "visual_design": 94,
    "ux_patterns": 90,
    "accessibility": 95,
    "code_quality": 88,
    "responsiveness": 93
  },
  "wcag_compliance": {
    "level": "AA",
    "score": 95,
    "critical_issues": 0,
    "warnings": 2
  },
  "performance": {
    "lighthouse_performance": 90,
    "lighthouse_accessibility": 98,
    "lighthouse_best_practices": 95,
    "lighthouse_seo": 92,
    "bundle_size_kb": 145,
    "load_time_ms": 1850
  },
  "generation": {
    "tokens_input": 3421,
    "tokens_output": 8934,
    "tokens_total": 12355,
    "cost_usd": 0.185,
    "time_seconds": 45,
    "iterations": 2,
    "model": "claude-opus-4-7"
  },
  "code_stats": {
    "lines_html": 421,
    "lines_css": 567,
    "lines_js": 89,
    "total_lines": 1077
  }
}
```

## Quality Criteria

Examples must meet these criteria to be included:

✅ **Quality score ≥ 85/100**
✅ **Accessibility score ≥ 90/100** (WCAG AA minimum)
✅ **Complete documentation** (all 4 files present)
✅ **Realistic content** (no lorem ipsum)
✅ **Professional appearance** (polished, production-ready)
✅ **Working code** (renders correctly, no errors)

## Collection Guidelines

### 1. Generation
- Use Open CoDesign with best prompts
- Use appropriate design system
- Allow 2-3 iterations if needed
- Save the final, polished version

### 2. Documentation
- Write design-decisions.md immediately (while fresh)
- Be specific about WHY choices were made
- Include alternatives considered
- Note trade-offs made

### 3. Metrics Collection
- Run accessibility verification
- Run code quality verification
- Check WCAG compliance
- Measure performance (if possible)
- Record generation details

### 4. Review
- Visual inspection (screenshot)
- Code review (clean, maintainable)
- Accessibility check (keyboard nav, screen reader)
- Responsive check (mobile, tablet, desktop)

## Usage

The reference library is automatically used by Open CoDesign when:
- User prompt matches an example category
- Few-shot learning is enabled (default)
- Examples exist in the relevant category

System loads top 3 most relevant examples and includes them in the prompt context.

## Target: 30 Examples

Minimum distribution:
- **Landing pages:** 5 examples (SaaS, agency, product, waitlist, portfolio)
- **Dashboards:** 5 examples (analytics, admin, monitoring, CRM, finance)
- **Mobile apps:** 5 examples (banking, fitness, social, shopping, messaging)
- **Presentations:** 5 examples (pitch, quarterly, workshop, research, sales)
- **E-commerce:** 5 examples (product, checkout, cart, storefront, order)
- **Components:** 5 examples (navigation, forms, cards, modals, tables)

## Current Status

Total examples: 0 / 30

By category:
- [ ] Landing pages: 0/5
- [ ] Dashboards: 0/5
- [ ] Mobile apps: 0/5
- [ ] Presentations: 0/5
- [ ] E-commerce: 0/5
- [ ] Components: 0/5

## How to Add an Example

1. Create directory: `category/example-name/`
2. Add all 4 required files (prompt.md, output.html, design-decisions.md, metrics.json)
3. Optional: Add screenshot.png
4. Update this README with count
5. Commit with message: `docs(references): add [example-name] to [category]`

## Example Prompts for Collection

### Landing Pages
```
Create a SaaS product launch page for an AI code review tool. Include hero with value prop, 3-column feature grid, customer logos, testimonials, pricing (3 tiers), FAQ, and CTA footer. Professional blue/gray palette.
```

### Dashboards
```
Create an analytics dashboard for e-commerce merchants. KPI cards (revenue, orders, conversion), revenue trend chart, top products table, traffic sources pie chart, recent orders list. Data-dense layout.
```

### Mobile Apps
```
Create a banking app home screen in iPhone frame. Account balance card, quick actions (pay/send/request), recent transactions, bottom navigation. Secure, professional design.
```

---

**Status:** Structure created, ready for example collection.
**Next:** Generate and collect 30+ high-quality examples.
