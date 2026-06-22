---
name: blog-article-skill
description: |
  Long-form reading experience with hero, table of contents, typography,
  pull quotes, and related articles. For editorial content, documentation, case studies.
triggers:
  - "blog article"
  - "blog post"
  - "article page"
  - "editorial"
  - "文章页面"
od:
  mode: prototype
  platform: desktop
  scenario: content
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [typography, layout]
  craft:
    requires: [typography]
  example_prompt: "Create a blog article page with hero image area, table of contents sidebar, long-form content, pull quotes, and related articles."
---

# Blog Article Skill

Create an immersive reading experience optimized for long-form content.

## Layout

**Desktop:**
```
┌────────────────────────────────────────┐
│ Header [Logo] [Nav]                    │
├────────────────────────────────────────┤
│ Hero Image Area (CSS gradient)         │
│ [Large Title]                          │
│ [Author] [Date] [Read time]            │
├──────────┬─────────────────────────────┤
│   TOC    │ Article Body               │
│  (sticky)│ Max 680px reading width    │
│   200px  │                            │
│          │ [Paragraphs]               │
│          │ [Pull Quote]               │
│          │ [Inline Images]            │
│          │ [Code Blocks]              │
│          │ [Footnotes]                │
├──────────┴─────────────────────────────┤
│ Related Articles (3-4 cards)           │
└────────────────────────────────────────┘
```

## Typography

**Reading comfort:**
- Body: 18-21px, 1.6-1.8 line-height
- Max width: 680px (65-75 characters)
- Serif font for body (optional)
- Generous margins

**Hierarchy:**
- H1: 40-56px (article title)
- H2: 28-32px (main sections)
- H3: 22-24px (subsections)
- Body: 18-21px
- Caption: 14-16px, muted

## Components

**Table of Contents:**
- Sticky sidebar (desktop only)
- Auto-generated from H2/H3
- Highlight current section
- Smooth scroll on click

**Pull Quote:**
- Large text (24-28px)
- Italic or serif
- Border or background
- Attribution if external

**Code Blocks:**
- Monospace font
- Syntax highlighting
- Copy button
- Line numbers (optional)

**Images:**
- Full-width or inset
- Captions below
- Alt text required
- Lazy loading

**Related Articles:**
- 3-4 cards at bottom
- Image + title + excerpt
- Same category/tags

## Mobile Optimization

- TOC becomes dropdown at top
- Images full-width
- Larger body text (19-20px)
- Comfortable tap targets
