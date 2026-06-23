---
name: progressive-web-app-skill
description: |
  PWA-ready mobile web app with offline support, install prompt, and app-like experience.
  For mobile-first web apps, installable experiences, offline-capable apps.
triggers:
  - "progressive web app"
  - "PWA"
  - "mobile web app"
  - "installable app"
od:
  mode: prototype
  platform: mobile
  scenario: application
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, typography, components]
  example_prompt: "Create a PWA for a task manager with offline support, bottom navigation, and native-like feel."
---

# Progressive Web App Skill

Create mobile web apps that feel native.

## PWA Characteristics

**App-like:**
- Full-screen (no browser chrome)
- Bottom tab navigation
- Swipe gestures
- Pull-to-refresh
- Native scrolling

**Installable:**
- Manifest file (referenced)
- App icons (referenced)
- Launch screen
- Display mode: standalone

**Offline-ready:**
- Service worker (referenced)
- Offline fallback page
- Cache-first strategy
- Sync when online

## Layout (Mobile)
```
┌────────────────┐
│ [Header/Title] │
├────────────────┤
│                │
│   Main         │
│   Content      │
│   Area         │
│                │
│                │
├────────────────┤
│ [Bottom Nav]   │
│ [⌂][+][☰][👤] │
└────────────────┘
```

## Features

**Navigation:**
- Bottom tab bar (4-5 items)
- Active state clear
- Icons + labels
- Large touch targets (56px)

**Interactions:**
- Smooth page transitions
- Pull-to-refresh indicator
- Loading skeletons
- Toast notifications
- Swipe to dismiss

**Performance:**
- Fast initial load (< 3s)
- Smooth 60fps scrolling
- Lazy load images
- Code splitting

**Accessibility:**
- Touch targets ≥ 44px
- High contrast mode
- Keyboard navigation
- Screen reader labels

## Manifest (referenced)
```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#2563eb">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

## Visual Design

**Mobile-first:**
- Full-width content
- Generous padding (16-24px)
- Large touch targets
- Clear hierarchy

**Typography:**
- Minimum 16px body (no zoom)
- Bold headings
- Comfortable line-height

**Colors:**
- Theme color for status bar
- Consistent with brand
- Dark mode support

## Offline Experience
- Show offline indicator
- Queue actions for later
- Cached content available
- "You're offline" message
- Sync icon when reconnected
