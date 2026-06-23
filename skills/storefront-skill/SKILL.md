---
name: storefront-skill
description: |
  E-commerce storefront with product grid, filters, search, and categories.
  For online store homepage, product catalog, shop page.
triggers:
  - "storefront"
  - "product catalog"
  - "shop page"
  - "store homepage"
  - "商城首页"
od:
  mode: prototype
  platform: desktop
  scenario: commerce
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  example_prompt: "Create an e-commerce storefront with hero banner, featured products, category grid, and product listing with filters."
---

# Storefront Skill

Create a conversion-optimized e-commerce homepage.

## Layout
```
┌────────────────────────────────────────┐
│ Header [Logo] [Search] [Cart] [User]  │
├────────────────────────────────────────┤
│ Hero Banner (Sale/Featured)            │
├─────┬──────────────────────────────────┤
│Filters│ Product Grid (3-4 cols)        │
│200px│ [Product Card] [Product Card]   │
│     │ [Product Card] [Product Card]   │
│     │ ... pagination ...              │
└─────┴──────────────────────────────────┘
```

## Product Card
- Image (square, 1:1)
- Product name (2 lines max)
- Price (large, bold)
- Rating (5 stars + count)
- "Add to Cart" on hover
- Sale badge if discounted
- "Out of Stock" overlay if needed

## Filters
- Category (checkbox list)
- Price range (slider)
- Brand (checkbox)
- Rating (4+ stars)
- Availability (in stock)
- Apply/Clear buttons

## Responsive
- Desktop: 4 columns
- Tablet: 3 columns
- Mobile: 2 columns
- Filters become drawer
