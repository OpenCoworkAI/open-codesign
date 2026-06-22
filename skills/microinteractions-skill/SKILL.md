---
name: microinteractions-skill
description: |
  Showcase of loading states, transitions, hover effects, and micro-animations.
  For component library, design system demos, interaction patterns.
triggers:
  - "microinteractions"
  - "loading states"
  - "hover effects"
  - "animations"
  - "微交互"
od:
  mode: prototype
  platform: desktop
  scenario: design
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, components]
  example_prompt: "Create a microinteractions showcase with loading indicators, button states, toast notifications, and smooth transitions."
---

# Microinteractions Skill

Create delightful micro-animations that enhance UX.

## Categories

**1. Loading States:**
- Spinner (circular, dots, bars)
- Skeleton loaders
- Progress bars
- Shimmer effect
- Pulsing placeholders

**2. Button States:**
- Default → Hover → Active → Disabled
- Loading state (spinner inside)
- Success state (checkmark)
- Error state (shake animation)

**3. Notifications:**
- Toast (slide in from top/bottom)
- Alert banners
- Snackbar
- Auto-dismiss after 5s

**4. Form Interactions:**
- Input focus (border glow)
- Validation checkmark
- Error shake
- Character counter

**5. Hover Effects:**
- Scale up (1.05)
- Shadow increase
- Color transition
- Underline expand

## Animation Principles
- **Duration:** 150-300ms typically
- **Easing:** ease-out for exits, ease-in for entrances
- **Subtle:** enhance, don't distract
- **Purposeful:** every animation has a reason
- **Accessible:** respect prefers-reduced-motion

## Layout
```
┌────────────────────────────────────────┐
│ Microinteractions Gallery              │
├────────────────────────────────────────┤
│ ## Loading Indicators                  │
│ [Spinner] [Dots] [Bars] [Skeleton]    │
│                                        │
│ ## Button States                       │
│ [Default] [Hover] [Loading] [Success] │
│                                        │
│ ## Notifications                       │
│ [Trigger Toast] [Show Alert]          │
│                                        │
│ ...                                    │
└────────────────────────────────────────┘
```

## CSS Animation Pattern
```css
.button {
  transition: transform 200ms ease-out,
              box-shadow 200ms ease-out;
}

.button:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

@media (prefers-reduced-motion: reduce) {
  .button {
    transition: none;
  }
}
```
