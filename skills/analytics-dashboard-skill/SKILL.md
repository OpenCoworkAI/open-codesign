---
name: analytics-dashboard-skill
description: |
  Data-heavy analytics dashboard with KPI cards, charts, tables, and filters.
  For SaaS analytics, business intelligence, metrics tracking, or data visualization.
triggers:
  - "analytics dashboard"
  - "data dashboard"
  - "metrics"
  - "business intelligence"
  - "数据看板"
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
  craft:
    requires: [typography, color]
  example_prompt: "Create an analytics dashboard for a SaaS product with MRR, user growth, feature usage, and conversion funnel."
---

# Analytics Dashboard Skill

Create a professional data visualization dashboard optimized for quick insights.

## Layout Structure

**Desktop (1440px):**
```
┌──────────────────────────────────────────┐
│ Header [Logo] [DateRange] [Export] [⚙]  │
├─────┬────────────────────────────────────┤
│ Nav │ KPI Strip (4 cards)               │
│ 200 ├────────────────────┬───────────────┤
│ px  │ Main Chart         │ Side Panel    │
│     │ (Line/Bar)         │ (Breakdown)   │
│     │ 60%                │ 40%           │
│     ├────────────────────┴───────────────┤
│     │ Data Table (paginated)            │
└─────┴────────────────────────────────────┘
```

**Components:**

1. **KPI Cards (4-6 metrics)**
   - Large number (primary metric)
   - Label below
   - Delta indicator (↑5.2% from last week)
   - Sparkline (optional mini-trend)
   - Color: green for positive, red for negative

2. **Main Chart**
   - Line chart for trends over time
   - Bar chart for comparisons
   - Stacked area for composition
   - Legend, axis labels, tooltips
   - Date range selector

3. **Data Table**
   - Sortable columns
   - Pagination (10/25/50 rows)
   - Search/filter
   - Export button
   - Row actions (view details)

4. **Filters**
   - Date range picker
   - Segment selector
   - Metric selector
   - Apply/Reset buttons

## Visual Design

**Typography:**
- Numbers: Monospace, tabular numerals
- Large metrics: 32-40px
- Labels: 12-14px, uppercase, tracking
- Table: 14px, consistent alignment

**Color coding:**
- Positive: Green (#10b981)
- Negative: Red (#ef4444)
- Neutral: Blue (#3b82f6)
- Muted: Gray (#6b7280)

**Charts:**
- Clean, minimal chrome
- Subtle gridlines
- Clear axis labels
- Accessible colors (not just hue differences)

## Data Best Practices

**Mock data should be:**
- Realistic (not round numbers like 1000, 2000)
- Trend patterns (growth, seasonal, etc.)
- Proper formatting ($1,234.56, 45.2%, 1.2K)

**Empty states:**
- "No data for selected period"
- Suggest action (change filter, wait for data)
- Show placeholder chart outline

**Loading states:**
- Skeleton loaders for cards/charts
- Shimmer effect
- Keep layout stable
