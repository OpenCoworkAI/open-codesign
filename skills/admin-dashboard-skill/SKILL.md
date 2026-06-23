---
name: admin-dashboard-skill
description: |
  Enterprise admin panel with navigation, data tables, user management,
  bulk actions, and settings. For backend management, CMS, admin tools.
triggers:
  - "admin dashboard"
  - "admin panel"
  - "backend dashboard"
  - "management interface"
  - "管理后台"
od:
  mode: prototype
  platform: desktop
  scenario: dashboard
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  example_prompt: "Create an admin dashboard for user management with table, filters, bulk actions, and CRUD operations."
---

# Admin Dashboard Skill

Create a powerful admin interface for managing data and users.

## Layout
```
┌──────────────────────────────────────────┐
│ [☰ Logo] Users [Search] [+New] [👤]     │
├─────┬────────────────────────────────────┤
│ Nav │ Page Title                         │
│200px│ [Filters] [Actions]                │
│     │ ┌──────────────────────────────┐  │
│Users│ │ Table (sortable, selectable)  │  │
│Items│ │ [☑] Name  Email  Role  Status │  │
│Logs │ │ [☐] John  j@... Admin  Active │  │
│Set. │ │ ... 50 rows ...              │  │
│     │ └──────────────────────────────┘  │
│     │ Showing 1-50 of 1,234 [Pagination]│
└─────┴────────────────────────────────────┘
```

## Key Features
**Table:**
- Checkbox select all/individual
- Sortable columns (↑↓ icons)
- Row hover highlight
- Row actions menu (⋮)
- Pagination controls

**Bulk Actions:**
- Delete selected
- Export selected
- Change status
- Assign role

**Filters:**
- Status dropdown
- Role select
- Date range
- Search query

**CRUD Operations:**
- Create: Modal or side panel
- Read: View detail page
- Update: Inline edit or modal
- Delete: Confirmation required
