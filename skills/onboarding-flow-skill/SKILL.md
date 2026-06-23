---
name: onboarding-flow-skill
description: |
  Multi-step user onboarding wizard with progress tracking, form validation,
  and completion celebration. For product tours, setup flows, or getting started.
triggers:
  - "onboarding"
  - "wizard"
  - "setup flow"
  - "getting started"
  - "引导流程"
od:
  mode: prototype
  platform: desktop
  scenario: flow
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  inputs:
    - name: step_count
      type: integer
      default: 4
      min: 2
      max: 8
  example_prompt: "Create a 4-step onboarding flow: profile setup, team invite, integrations, and tutorial completion."
---

# Onboarding Flow Skill

Create an engaging onboarding that gets users to activation quickly.

## Flow Structure

**Typical steps:**
1. Welcome + Value prop
2. Profile/Account setup
3. Preferences/Settings
4. Integrations/Connections
5. Tutorial/First action
6. Success celebration

**Layout:**
```
┌────────────────────────────────────────┐
│ [Logo]           [Step 2 of 4]     [×] │
├────────────────────────────────────────┤
│                                        │
│   ●━━━━━━●━━━━━━○━━━━━━○             │
│   Profile  Team   Setup  Done          │
│                                        │
│   [Step Content Area]                  │
│                                        │
│   [Skip]              [Next Step →]    │
└────────────────────────────────────────┘
```

## Key Principles

**Progress visibility:**
- Clear step indicator
- Number of steps shown
- Can't go back (usually)

**One goal per step:**
- Single focus, no distractions
- Clear benefit statement
- Minimal fields (3-5 max)

**Skip option:**
- Allow skip for optional steps
- "I'll do this later" link
- Save progress automatically

**Celebration:**
- Success animation on completion
- Clear next steps
- CTA to main product

## Visual Design

**Step indicator:**
- Horizontal dots/line
- Current step highlighted
- Completed steps with checkmark
- Future steps grayed out

**Content card:**
- Centered, max-width 600px
- Generous padding
- Illustration/icon for each step
- Clear headline and description

**Buttons:**
- Primary: "Next" / "Complete Setup"
- Secondary: "Skip" / "Back"
- Full-width on mobile
