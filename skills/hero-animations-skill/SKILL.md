---
name: hero-animations-skill
description: |
  Engaging hero section with animations, CTAs, and visual interest.
  For landing pages, marketing sites, product launches.
triggers:
  - "hero section"
  - "animated hero"
  - "landing hero"
  - "首屏动画"
od:
  mode: prototype
  platform: desktop
  scenario: marketing
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, typography, layout]
  example_prompt: "Create an animated hero section with gradient background, floating elements, headline with typewriter effect, and primary CTA."
---

# Hero Animations Skill

Create captivating hero sections that grab attention.

## Layout
```
┌────────────────────────────────────────┐
│                                        │
│         [Animated Elements]            │
│                                        │
│      Your Headline Here                │
│      Subheadline text that explains    │
│                                        │
│      [Primary CTA] [Secondary CTA]     │
│                                        │
│      [Trust Signal] [Social Proof]     │
│                                        │
└────────────────────────────────────────┘
```

## Animation Types

**Background:**
- Gradient shift (hue rotation)
- Particle field (CSS/SVG)
- Geometric shapes floating
- Subtle mesh gradient

**Text Animations:**
- Fade in + slide up
- Typewriter effect
- Word-by-word reveal
- Gradient text animation

**Elements:**
- Floating cards/screenshots
- Parallax layers
- Rotating 3D objects (CSS transform)
- Pulsing glows

## Principles

**Performance:**
- CSS animations preferred
- GPU-accelerated (transform, opacity)
- No layout thrashing
- Pause on scroll out

**Accessibility:**
- Respect prefers-reduced-motion
- Don't rely on animation for content
- Keyboard navigable
- No seizure-inducing flashing

**Subtlety:**
- Smooth, not jarring
- Enhance, don't distract
- 60fps target
- Natural easing

## Example Animations

```css
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.headline {
  animation: fadeInUp 800ms ease-out forwards;
}

@media (prefers-reduced-motion: reduce) {
  .headline {
    animation: none;
  }
}
```
