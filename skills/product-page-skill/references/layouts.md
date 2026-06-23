# Product Page Layout Patterns

## Pattern A: Split-Screen (Recommended for Desktop)

**Best for:** Products with strong visual appeal (fashion, electronics, furniture)

**Structure:**
```
┌────────────────────────────────────┐
│  Breadcrumb                        │
├──────────────┬─────────────────────┤
│              │                     │
│   Gallery    │   Product Info      │
│   (60%)      │   (40%)             │
│              │   - Name            │
│   [Main Img] │   - Rating          │
│              │   - Price           │
│   [Thumbs]   │   - Description     │
│              │   - Variants        │
│              │   - Add to Cart     │
│              │   - Trust Badges    │
│              │                     │
├──────────────┴─────────────────────┤
│   Tabs (Description/Specs/Reviews) │
├────────────────────────────────────┤
│   Reviews Section                  │
├────────────────────────────────────┤
│   Related Products Grid            │
└────────────────────────────────────┘
```

**When to use:**
- Desktop-first experience
- Products benefit from large imagery
- Enough information to fill right column

**Responsive behavior:**
- < 1024px: Info column narrows to 45%
- < 768px: Stack vertically (gallery top)
- < 480px: Full-width, sticky CTA bar

---

## Pattern B: Stacked (Mobile-First)

**Best for:** Content-heavy products (books, courses, services)

**Structure:**
```
┌────────────────────────┐
│  Breadcrumb            │
├────────────────────────┤
│  Gallery (Full-width)  │
│  [Main Image]          │
│  [Thumbnail Strip]     │
├────────────────────────┤
│  Product Name          │
│  Rating & Reviews      │
│  Price                 │
├────────────────────────┤
│  Short Description     │
│  Key Features List     │
├────────────────────────┤
│  Variants Selection    │
├────────────────────────┤
│  Add to Cart           │
│  Trust Badges          │
├────────────────────────┤
│  Tabs/Accordion        │
├────────────────────────┤
│  Reviews               │
├────────────────────────┤
│  Related Products      │
└────────────────────────┘
```

**When to use:**
- Mobile-first strategy
- Product needs detailed explanation
- Limited visual differentiation

**Responsive behavior:**
- Naturally responsive
- Just adjust padding and font sizes
- Consider sticky CTA on mobile

---

## Pattern C: Sidebar (Variant-Heavy)

**Best for:** Products with many options (apparel with sizes/colors, configurable items)

**Structure:**
```
┌────────────────────────────────────┐
│  Breadcrumb                        │
├──────────────────────┬─────────────┤
│                      │             │
│   Gallery + Info     │  Sticky     │
│   (70%)              │  Purchase   │
│                      │  Sidebar    │
│   [Main Image]       │  (30%)      │
│                      │             │
│   [Thumbnails]       │  Price      │
│                      │  Variants   │
│   Product Name       │  Quantity   │
│   Rating             │  Add Cart   │
│   Description        │  Wishlist   │
│                      │  Trust      │
│                      │             │
├──────────────────────┴─────────────┤
│   Tabs                             │
├────────────────────────────────────┤
│   Reviews                          │
├────────────────────────────────────┤
│   Related Products                 │
└────────────────────────────────────┘
```

**When to use:**
- Many variants (colors, sizes, configurations)
- Price changes based on selection
- Want purchase options always visible

**Responsive behavior:**
- < 1024px: Sidebar becomes 35%
- < 768px: Sidebar moves to bottom, becomes sticky bar
- < 480px: Full-width stacked

---

## Choosing the Right Pattern

| Product Type | Pattern | Why |
|---|---|---|
| Fashion/Apparel | Sidebar | Many size/color options |
| Electronics | Split-Screen | Strong visuals, specs matter |
| Furniture | Split-Screen | Large images crucial |
| Books/Digital | Stacked | Content over imagery |
| Custom/Configurable | Sidebar | Complex option selection |
| Luxury Items | Split-Screen | Image quality sells |

---

## Responsive Breakpoints

```css
/* Desktop-first approach */
@media (max-width: 1024px) { /* Tablet landscape */ }
@media (max-width: 768px)  { /* Tablet portrait */ }
@media (max-width: 480px)  { /* Mobile */ }
```

**Key transformations:**
- Gallery: Grid → Carousel
- Info sections: Side-by-side → Stacked
- CTA: Inline → Sticky bottom bar
- Tabs: Horizontal → Accordion
