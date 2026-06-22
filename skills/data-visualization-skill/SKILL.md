---
name: data-visualization-skill
description: |
  Interactive data visualization with charts, graphs, and insights.
  For data presentation, reports, analytics, dashboards.
triggers:
  - "data visualization"
  - "charts"
  - "graphs"
  - "data dashboard"
  - "数据可视化"
od:
  mode: prototype
  platform: desktop
  scenario: dashboard
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, typography]
  example_prompt: "Create a data visualization page with line chart, bar chart, pie chart, and data table showing quarterly revenue."
---

# Data Visualization Skill

Create clear, insightful data visualizations.

## Chart Types

**Line Chart:**
- Time-series data
- Trends over time
- Multiple lines for comparison
- Grid lines, axis labels
- Tooltip on hover

**Bar Chart:**
- Categorical comparisons
- Vertical or horizontal
- Grouped or stacked
- Clear value labels

**Pie/Donut Chart:**
- Part-to-whole relationships
- Maximum 5-6 slices
- Percentage labels
- Legend with values

**Area Chart:**
- Composition over time
- Stacked areas
- Smooth curves
- Filled under line

## Design Principles

**Color:**
- Use accessible color palette
- Not just hue (add patterns)
- Consistent across charts
- Semantic colors (green=good, red=bad)

**Typography:**
- Clear axis labels
- Readable value labels
- Legend descriptions
- Data source attribution

**Interactivity:**
- Hover tooltips with exact values
- Click to drill down
- Filter controls
- Export options

**Layout:**
```
┌────────────────────────────────────────┐
│ Revenue Analysis Q1-Q4 2026            │
├────────────────────────────────────────┤
│ [Date Range] [Segment] [Export]        │
├─────────────────────┬──────────────────┤
│ Line Chart          │ Key Metrics      │
│ (Revenue Trend)     │ $1.2M Total      │
│                     │ +15% Growth      │
├─────────────────────┴──────────────────┤
│ Bar Chart (By Category)                │
├────────────────────────────────────────┤
│ Data Table (Top 10)                    │
└────────────────────────────────────────┘
```

## Implementation

Use SVG for charts:
- Scalable, crisp at any size
- CSS styling
- Accessible with ARIA labels
- No external libraries needed for basic charts
