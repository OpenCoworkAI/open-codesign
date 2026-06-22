---
name: responsive-design-system-skill
description: |
  Component library showcase with responsive examples, code snippets, and usage guidelines.
  For design systems, component docs, pattern libraries.
triggers:
  - "design system"
  - "component library"
  - "pattern library"
  - "UI kit"
  - "组件库"
od:
  mode: design-system
  platform: desktop
  scenario: design
  preview:
    type: html
    entry: index.html
  design_system:
    requires: false
  example_prompt: "Create a design system showcase with buttons, forms, cards, and navigation components with responsive examples."
---

# Responsive Design System Skill

Create comprehensive component library documentation.

## Layout
```
┌────────────────────────────────────────┐
│ [Logo] Design System [Search] [GitHub]│
├─────┬──────────────────────────────────┤
│Nav  │ Components > Buttons             │
│     │                                  │
│Foun │ # Buttons                        │
│dati │                                  │
│ons  │ ## Variants                      │
│Comp │ [Primary] [Secondary] [Ghost]   │
│onen │                                  │
│ ts  │ ## Sizes                         │
│Butt │ [Large] [Medium] [Small]        │
│ons  │                                  │
│Form │ ## States                        │
│ s   │ [Default] [Hover] [Disabled]    │
│Card │                                  │
│ s   │ ## Code                          │
│     │ ```html                          │
│     │ <button class="btn-primary">    │
│     │   Click me                       │
│     │ </button>                        │
│     │ ```                              │
└─────┴──────────────────────────────────┘
```

## Sections

**1. Foundations:**
- Colors (palette with hex codes)
- Typography (scale, weights, line-heights)
- Spacing (scale with visual examples)
- Grid system
- Icons

**2. Components:**
- Buttons (all variants + states)
- Forms (inputs, selects, checkboxes, radio)
- Cards (different layouts)
- Navigation (header, sidebar, tabs)
- Modals/Dialogs
- Tables
- Alerts/Toasts
- Badges/Pills

**3. Patterns:**
- Empty states
- Loading states
- Error states
- Success states
- Authentication flows
- Search patterns

## Component Page Structure

```markdown
# Component Name

Brief description of when to use this component.

## Variants
[Visual examples of each variant]

## Sizes
[Visual examples of sizes]

## States
[Default, Hover, Focus, Active, Disabled]

## Usage Guidelines
✓ Do: Use for primary actions
✗ Don't: Use more than one primary button

## Accessibility
- Keyboard: Space/Enter to activate
- Screen reader: Announces as button
- Focus: Visible outline required

## Code
```html
<button class="btn btn-primary">
  Button text
</button>
```

## Props / Classes
| Class | Description |
|---|---|
| `.btn-primary` | Primary action |
| `.btn-secondary` | Secondary action |
| `.btn-lg` | Large size |
```

## Interactive Demos
- Live playground where users can:
  - Toggle variants
  - Change sizes
  - Test states
  - Copy code

## Responsive Behavior
Show component at different breakpoints:
- Mobile (375px)
- Tablet (768px)
- Desktop (1440px)

## Design Tokens

Show CSS custom properties:
```css
:root {
  --color-primary: #2563eb;
  --color-secondary: #64748b;
  --spacing-unit: 8px;
  --font-sans: 'Inter', sans-serif;
  --radius-md: 6px;
}
```

## Visual Design

**Layout:**
- Generous spacing between examples
- Clear labels
- Grouped by type

**Code blocks:**
- Syntax highlighting
- Copy button
- Tab for different frameworks (HTML, React, Vue)

**Examples:**
- Real, not abstract
- Show in context
- Multiple use cases
