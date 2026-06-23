---
name: documentation-site-skill
description: |
  Technical documentation site with sidebar navigation, search, code examples,
  and next/prev links. For API docs, developer guides, knowledge base.
triggers:
  - "documentation"
  - "docs site"
  - "developer docs"
  - "knowledge base"
  - "文档站点"
od:
  mode: prototype
  platform: desktop
  scenario: content
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [typography, layout, components]
  craft:
    requires: [typography]
  example_prompt: "Create a documentation site with sidebar navigation, code examples, search, and API reference sections."
---

# Documentation Site Skill

Create clear, scannable technical documentation.

## Layout
```
┌────────────────────────────────────────┐
│ [Logo] [Search] [GitHub] [Theme] [v1.2]│
├────────┬───────────────────────────────┤
│ Nav    │ Breadcrumb: Docs > API > Auth │
│ Tree   │                               │
│200px   │ # Authentication              │
│        │                               │
│Getting │ Overview text...             │
│Started │                               │
│API     │ ## API Keys                   │
│ Auth   │ ```js                         │
│ Users  │ const api = new API({         │
│ Posts  │   key: 'your-key'            │
│Guides  │ })                            │
│        │ ```                           │
│        │                               │
│        │ [◀ Prev] [Next ▶]            │
└────────┴───────────────────────────────┘
```

## Features
**Sidebar Nav:**
- Collapsible sections
- Active page highlight
- Scroll to active on load

**Content:**
- Markdown-style formatting
- Code blocks with syntax highlighting
- Copy button on code
- Inline code styling
- Tables for parameters
- Callout boxes (note/warning/tip)

**Code Examples:**
- Tabs for multiple languages
- Line numbers
- Highlight specific lines
- "Run in playground" link

**Search:**
- Fuzzy search across all docs
- Keyboard shortcut (⌘K)
- Results with context

**Navigation:**
- Breadcrumbs at top
- Prev/Next at bottom
- "Edit on GitHub" link
- Version selector
