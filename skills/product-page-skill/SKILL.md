---
name: product-page-skill
description: |
  E-commerce product detail page with image gallery, product information,
  reviews, add-to-cart, and related products. Use when the brief asks for
  a product page, product detail, item page, or e-commerce product view.
triggers:
  - "product page"
  - "product detail"
  - "item page"
  - "e-commerce product"
  - "product view"
  - "商品详情页"
  - "产品页面"
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
  craft:
    requires: [typography, color, anti-ai-slop]
  inputs:
    - name: product_name
      type: string
      required: true
    - name: price
      type: string
      default: "$99.00"
    - name: has_reviews
      type: boolean
      default: true
    - name: has_gallery
      type: boolean
      default: true
  capabilities_required:
    - file_write
  example_prompt: "Create a product detail page for a premium wireless headphone with gallery, specs, reviews, and add-to-cart."
---

# Product Page Skill

Create a professional e-commerce product detail page optimized for conversion and user trust.

## Resource map

```
product-page-skill/
├── SKILL.md                    ← you're reading this
├── assets/
│   └── template.html           ← base HTML structure
├── references/
│   ├── layouts.md             ← layout patterns (split-screen, stacked, sidebar)
│   ├── components.md          ← reusable components (gallery, reviews, specs)
│   └── best-practices.md      ← e-commerce conversion principles
└── tests/
    ├── basic.prompt           ← test case
    └── basic.expected.json    ← expected output
```

## When to use this skill

Use this when the user asks for:
- Product detail page
- Item page for e-commerce
- Product showcase with purchase option
- Single-product landing page
- Product view with reviews and specs

If the user asks for a full store or catalog, suggest using the `storefront-skill` instead.

## Workflow

### Step 1 — Understand the product

Ask clarifying questions if needed:
- Product category (electronics, fashion, furniture, etc.)
- Key features to highlight
- Price range
- Target audience (luxury, budget, professional)

### Step 2 — Choose layout pattern

Read `references/layouts.md` and pick one:

| Pattern | Best for | Layout |
|---|---|---|
| **Split-screen** | Products with strong visuals | Gallery left (60%), info right (40%) |
| **Stacked** | Mobile-first, content-heavy | Gallery top, info below, full-width |
| **Sidebar** | Products with many variants | Main content center, sticky sidebar for purchase |

Default to **split-screen** for desktop, **stacked** for mobile.

### Step 3 — Build the page structure

**Required sections (in order):**

1. **Header/Breadcrumbs**
   - Category breadcrumb trail
   - Back to category link
   - Search and cart icons (non-functional but styled)

2. **Product Gallery** (if `has_gallery`)
   - Main image (large, zoomable affordance)
   - Thumbnail strip (3-6 images)
   - Use CSS gradient placeholders, not external images
   - Add hover states on thumbnails
   - Include "zoom" icon or text on hover

3. **Product Information**
   - Product name (H1, prominent)
   - Rating stars + review count (if `has_reviews`)
   - Price (large, bold, monospace numerals)
   - Was/Now pricing if on sale
   - Short description (2-3 sentences)
   - Key features (bullet list, 4-6 items)

4. **Variants Selection** (optional but recommended)
   - Color swatches (visual, not just text)
   - Size selector (buttons, not dropdown)
   - Quantity stepper
   - Stock status ("In stock" / "Low stock" / "Out of stock")

5. **Add to Cart Section**
   - Primary CTA button ("Add to Cart" or "Buy Now")
   - Secondary action ("Add to Wishlist" icon button)
   - Trust badges (free shipping, returns, warranty)

6. **Tabs or Accordion**
   - Description (detailed, 2-3 paragraphs)
   - Specifications (table format)
   - Shipping & Returns (clear policy)
   - Reviews (if `has_reviews`)

7. **Reviews Section** (if `has_reviews`)
   - Overall rating summary (stars + breakdown bars)
   - Filter/sort controls
   - 3-5 review cards with:
     - Reviewer name + verified badge
     - Star rating
     - Review text (2-4 lines)
     - Helpful votes count
     - Date

8. **Related Products**
   - "You might also like" section
   - 4 product cards in a grid
   - Each card: image placeholder, name, price, rating

9. **Footer** (minimal)
   - Trust signals (secure checkout, returns policy)
   - Company links

### Step 4 — Apply design system

Read the active `DESIGN.md`:
- Use color tokens for brand, backgrounds, borders
- Apply typography scales (H1 for product name, body for description)
- Use spacing rhythm (8px grid typically)
- Match button styles to design system

**E-commerce specific styles:**
- Price: larger than body text, monospace or tabular numerals
- CTA button: high-contrast, minimum 48px height, full-width on mobile
- Trust badges: subtle, not overwhelming
- Reviews: stars in brand color or gold (#F59E0B default)

### Step 5 — Add interactions

**Micro-interactions to include:**
- Hover state on thumbnails (border highlight)
- Active state on variant selectors (selected color/size)
- Button hover (slight scale or color shift)
- Quantity stepper (+ and - buttons, disable at limits)
- Tab switching (underline or background change)
- "Add to Cart" success state (checkmark animation or color change)

**Accessibility:**
- Gallery: alt text on all images ("Product view from front", "Product view from side")
- Variants: proper label association, radio buttons or checkboxes
- Quantity: label for screen readers, min/max attributes
- Reviews: rating announced ("4 out of 5 stars")
- Tabs: ARIA tabs pattern or accordion with proper headings

### Step 6 — Handle edge cases

**Empty states:**
- No reviews yet: "Be the first to review this product" with CTA
- Out of stock: disable "Add to Cart", show "Notify when available"
- No variants: hide selector section

**Long content:**
- Product name: truncate after 2 lines with ellipsis on small screens
- Description: "Read more" expansion if > 200 words
- Reviews: paginate or "Load more" after 5

**Mobile considerations:**
- Gallery: swipeable carousel, not thumbnail strip
- Variants: stack vertically, larger touch targets
- Sticky "Add to Cart" bar at bottom
- Tabs become accordion

### Step 7 — Self-check against e-commerce best practices

Before calling `done`, verify:

□ **Conversion-focused:**
  - Price is immediately visible (above the fold)
  - CTA button is prominent, high-contrast, clear label
  - Trust signals are present (reviews, ratings, badges)
  - Urgency indicators if appropriate (limited stock, sale ends)

□ **Trust-building:**
  - Real product information (not lorem ipsum)
  - Specific features (not generic "high quality")
  - Review content is realistic
  - Clear shipping and return policy

□ **Visual hierarchy:**
  - Product name is the largest text
  - Price is second most prominent
  - CTA button is visually heaviest element
  - Supporting info is clearly secondary

□ **Responsive:**
  - Gallery adapts (grid → carousel)
  - Info sections stack on narrow screens
  - CTA remains accessible (sticky or repeated)
  - Touch targets ≥ 44px on mobile

□ **Accessible:**
  - All images have alt text
  - Form controls have labels
  - Color contrast meets WCAG AA
  - Keyboard navigation works (tab through variants, CTA)

### Step 8 — Emit the artifact

Write one self-contained `index.html` with:
- Inline CSS in `<style>` block
- Semantic HTML5 structure
- CSS custom properties for theming
- No external dependencies (no jQuery, no framework)
- Realistic product data (not placeholders)

Stop after writing the file. No lengthy narration needed.

## Visual rules

**Layout:**
- Desktop: 1200px max-width, centered
- Gallery: 60% width on left, sticky scroll
- Info: 40% width on right, scrollable
- Mobile: full-width stacked, 16px side padding

**Typography:**
- Product name: 32-40px, bold, brand font
- Price: 24-28px, monospace numerals, brand color
- Body: 16px, comfortable line-height (1.6)
- Features: bullet list, 15px, tight spacing

**Color:**
- Use design system accent for CTA and stars
- Neutral grays for borders and backgrounds
- Green for "In stock", red for "Out of stock"
- Black or very dark gray for product name

**Spacing:**
- Sections: 48-64px vertical gap
- Cards: 24px padding
- Buttons: 12px vertical, 24px horizontal padding
- Grid gaps: 24px between related products

**Components:**
- Buttons: rounded corners (6-8px), solid background
- Cards: subtle border, no heavy shadows
- Tabs: underline style, not heavy borders
- Stars: filled or outline, 16-20px size

## Anti-patterns to avoid

❌ Generic stock photo aesthetics (use CSS gradients for placeholders)  
❌ Lorem ipsum product descriptions  
❌ Fake "5000 sold today" urgency  
❌ Tiny "Add to Cart" button  
❌ No mobile optimization  
❌ Inaccessible color pickers (color name labels required)  
❌ Hidden shipping costs  
❌ Overwhelming number of CTAs  

## Example output structure

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Product Name - Your Store</title>
  <style>
    :root {
      --brand: #2563eb;
      --text: #111827;
      --text-muted: #6b7280;
      --border: #e5e7eb;
      --success: #10b981;
    }
    /* ... styles ... */
  </style>
</head>
<body>
  <header><!-- Breadcrumbs --></header>
  
  <main>
    <div class="product-container">
      <section class="gallery"><!-- Gallery --></section>
      <section class="info">
        <h1><!-- Product Name --></h1>
        <div class="rating"><!-- Stars + Reviews --></div>
        <p class="price"><!-- Price --></p>
        <p class="description"><!-- Short description --></p>
        <ul class="features"><!-- Key features --></ul>
        
        <div class="variants"><!-- Color/Size selectors --></div>
        
        <div class="purchase">
          <button class="btn-primary">Add to Cart</button>
          <button class="btn-secondary">♥ Wishlist</button>
        </div>
        
        <div class="trust-badges"><!-- Free shipping, etc. --></div>
      </section>
    </div>
    
    <section class="tabs"><!-- Description/Specs/Shipping/Reviews --></section>
    
    <section class="reviews"><!-- Review cards --></section>
    
    <section class="related"><!-- Related products --></section>
  </main>
  
  <footer><!-- Trust signals --></footer>
</body>
</html>
```

## Testing

Run through these scenarios:
1. Desktop 1440px: gallery and info side-by-side
2. Tablet 768px: info starts to stack
3. Mobile 375px: full stack, sticky CTA
4. Out of stock state: CTA disabled
5. No reviews state: empty state with CTA

All should look intentional and professional.
