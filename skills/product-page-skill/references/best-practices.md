# E-Commerce Product Page Best Practices

## Conversion Optimization

### Above the Fold (First Screen)
✅ **Must include:**
- Product name (clear, descriptive)
- Main product image (high quality)
- Price (prominent, easy to spot)
- Primary CTA ("Add to Cart")
- Key trust signal (reviews, rating)

❌ **Avoid:**
- Requiring scroll to see price
- Hidden or unclear CTA
- No visual of product
- Overwhelming with too many options

### Call-to-Action (CTA)
✅ **Best practices:**
- Clear action verb ("Add to Cart", "Buy Now", not "Submit")
- High contrast color (stands out from page)
- Large enough (min 48px height, full-width on mobile)
- Single primary action (don't compete with multiple CTAs)
- Disabled state when out of stock

❌ **Avoid:**
- Multiple competing primary buttons
- Generic text ("Click here", "Submit")
- Tiny button with small touch target
- Unclear what happens on click

---

## Trust & Credibility

### Social Proof
✅ **Include:**
- Star rating (visible, not hidden)
- Number of reviews (e.g., "4.8 ★ (1,234 reviews)")
- Review highlights (verified purchases, photos)
- "Bestseller" or "Trending" badges (if true)

### Trust Badges
✅ **Effective signals:**
- Free shipping (or threshold: "Free shipping over $50")
- Easy returns ("30-day return policy")
- Warranty or guarantee
- Secure checkout icons
- Customer support availability

❌ **Avoid:**
- Fake urgency ("Only 2 left!" when false)
- Made-up badges or certifications
- Overwhelming number of badges
- Trust signals that feel spammy

---

## Product Information

### Product Name
✅ **Good:** "Sony WH-1000XM5 Wireless Noise-Cancelling Headphones - Black"  
❌ **Bad:** "Headphones" or "Premium Audio Device XYZ-123"

**Rules:**
- Include brand if relevant
- Be specific (model, key feature)
- Add variant info (color, size) if applicable
- Keep under 60 characters for SEO

### Description
✅ **Structure:**
1. **Short description** (2-3 sentences, benefits-focused)
2. **Key features** (bullet list, 4-6 items, scannable)
3. **Long description** (detailed, 2-3 paragraphs, behind tab)

**Focus on benefits, not just features:**
- ❌ "Bluetooth 5.0 connectivity"
- ✅ "Connect seamlessly to any device with the latest Bluetooth 5.0 — enjoy 30 hours of wireless playback"

### Specifications
✅ **Format as table:**
```
Dimensions:     7.3 × 6.5 × 2.9 inches
Weight:         8.8 oz (250g)
Battery Life:   Up to 30 hours
Connectivity:   Bluetooth 5.0, 3.5mm jack
Warranty:       2 years manufacturer
```

❌ **Avoid:** Long paragraphs of specs mixed together

---

## Visual Design

### Images
✅ **Gallery best practices:**
- Main image: product on white/neutral background
- Multiple angles (front, side, back, detail shots)
- Lifestyle images (product in use)
- Zoom functionality (or high-res on click)
- 4-6 images typically sufficient

❌ **Avoid:**
- Low-resolution images
- Inconsistent backgrounds
- Only one angle
- Overly edited/unrealistic

### Layout
✅ **Visual hierarchy:**
1. Product name (largest text)
2. Price (second largest, monospace)
3. Rating/reviews (prominent but supporting)
4. CTA button (visually heaviest element)
5. Everything else (clearly secondary)

### Color
✅ **Use color purposefully:**
- Brand color for CTA and accent elements
- Green for "In Stock", "Sale", positive indicators
- Red for "Out of Stock", errors, warnings
- Neutral grays for borders and backgrounds

❌ **Avoid:**
- Random pops of color with no meaning
- Poor contrast (especially price on colored backgrounds)
- Using only color to convey information (accessibility issue)

---

## Variants & Options

### Color Selection
✅ **Visual swatches:**
- Show actual color (swatch, not just text "Blue")
- Include color name on hover or below
- Clear selected state (border, checkmark)
- Disable unavailable colors (grayed out, diagonal line)

### Size Selection
✅ **Button group style:**
- Clear buttons for each size (S, M, L, XL)
- Selected state (filled or outlined)
- Size guide link nearby
- Disable unavailable sizes

### Quantity
✅ **Stepper control:**
- Plus and minus buttons
- Number input in center (editable)
- Disable at min (1) and max (stock limit)
- Show stock level if low ("Only 3 left")

---

## Reviews Section

### Summary
✅ **Display:**
- Overall rating (large, e.g., "4.8 / 5.0")
- Total review count
- Star distribution bars (5★ to 1★ with percentages)
- Filters: Most helpful, Recent, Highest/Lowest rated

### Individual Reviews
✅ **Each review includes:**
- Reviewer name or initials
- Verified purchase badge
- Star rating
- Review date
- Review text (2-4 lines visible, "Read more" for longer)
- Helpful votes ("52 people found this helpful")
- Optional: Review photos

❌ **Avoid:**
- Only showing 5-star reviews (looks fake)
- No verification or credibility signals
- Allowing fake-looking reviews
- Hiding negative reviews

---

## Mobile Optimization

### Layout Changes
✅ **Mobile adaptations:**
- Gallery becomes swipeable carousel
- Info sections stack vertically
- Variants use larger touch targets (min 44×44px)
- Sticky "Add to Cart" bar at bottom
- Tabs become accordion
- Related products: 2-column grid or horizontal scroll

### Performance
✅ **Mobile-specific:**
- Lazy-load images below fold
- Optimize main image for mobile (smaller dimensions)
- Reduce animation/effects
- Fast initial load (< 3 seconds)

---

## Accessibility

### WCAG Requirements
✅ **Must have:**
- Alt text on all images ("Product front view", not just "Product")
- Form labels (not just placeholders)
- Color contrast meets WCAG AA (4.5:1 for text)
- Keyboard navigation (tab through all interactive elements)
- Focus indicators (visible outline on focused elements)
- ARIA labels where needed (star ratings, icon buttons)

### Common Issues to Avoid
❌ Color-only indicators (e.g., color swatch without name)  
❌ Icon-only buttons without labels (wishlist, share)  
❌ Auto-playing videos with sound  
❌ Time-limited sales without warning  

---

## Edge Cases

### Out of Stock
✅ **Handle gracefully:**
- Clear "Out of Stock" message
- Disable "Add to Cart" button
- Offer "Notify When Available" option
- Show similar available products
- Keep page structure intact (don't hide everything)

### No Reviews Yet
✅ **Encourage first review:**
- "Be the first to review this product"
- Clear CTA to write review
- Explain review benefits (helps others, builds trust)

### Sale/Discount
✅ **Show clearly:**
- Original price (crossed out)
- Sale price (prominent, in brand color)
- Discount percentage or amount saved
- Sale end date if applicable
- "Sale" or "Limited Time" badge

---

## SEO Considerations

✅ **On-page SEO:**
- Unique, descriptive title tag (< 60 chars)
- Product name in H1 (only one H1)
- Structured data (Product schema)
- Descriptive alt text on images
- Readable URLs (not IDs: /products/wireless-headphones not /p/12345)

---

## Performance

✅ **Speed optimizations:**
- Lazy-load images (especially gallery thumbnails)
- Inline critical CSS
- Defer non-critical JavaScript
- Optimize images (WebP format, responsive sizes)
- Minimize initial bundle size

**Target metrics:**
- First Contentful Paint: < 1.5s
- Largest Contentful Paint: < 2.5s
- Cumulative Layout Shift: < 0.1

---

## Common Mistakes to Avoid

1. **Hidden Costs**
   - Show shipping cost early
   - Don't surprise at checkout

2. **Overwhelming Choices**
   - Too many variants confuse
   - Limit to essential options

3. **Poor Mobile Experience**
   - Desktop-only thinking
   - Tiny text and buttons

4. **Fake Urgency**
   - False scarcity
   - Fake countdown timers

5. **No Clear Value Proposition**
   - Generic descriptions
   - Missing "why this product"

6. **Ignoring Accessibility**
   - Low contrast
   - No keyboard navigation
