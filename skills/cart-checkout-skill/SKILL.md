---
name: cart-checkout-skill
description: |
  Complete shopping cart and checkout flow with cart summary, shipping form,
  payment method, order review, and confirmation. Use for e-commerce checkout,
  cart page, payment flow, or order completion.
triggers:
  - "checkout"
  - "shopping cart"
  - "payment flow"
  - "order form"
  - "购物车"
  - "结账流程"
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
    - name: flow_type
      type: enum
      values: [single_page, multi_step]
      default: multi_step
    - name: show_cart
      type: boolean
      default: true
  capabilities_required:
    - file_write
  example_prompt: "Create a multi-step checkout flow with cart review, shipping address, payment method, and order confirmation."
---

# Cart & Checkout Skill

Create a conversion-optimized checkout flow that minimizes cart abandonment.

## Workflow

### Step 1 — Choose flow type

**Single-page checkout:**
- All steps visible at once
- Good for: Simple products, B2B, desktop-heavy traffic
- Pros: Fewer clicks, faster for power users
- Cons: Can feel overwhelming, harder on mobile

**Multi-step checkout:**
- Steps revealed progressively (cart → shipping → payment → confirm)
- Good for: Complex orders, mobile-first, general e-commerce
- Pros: Less cognitive load, better mobile UX, clear progress
- Cons: More clicks, perceived as longer

Default to **multi-step** for most use cases.

### Step 2 — Structure the flow

**Multi-step structure:**

1. **Cart Review** (if show_cart)
   - Item list with thumbnails, name, price, quantity
   - Quantity adjustment (+ / -)
   - Remove item button
   - Subtotal calculation
   - Promo code input
   - "Continue to Shipping" CTA
   - "Continue Shopping" secondary link

2. **Shipping Information**
   - Progress indicator (Step 1 of 3)
   - Email for order updates
   - Shipping address form (name, address, city, zip, country)
   - "Ship to different address" checkbox (optional)
   - Shipping method selection (standard, express, overnight)
   - "Continue to Payment" CTA
   - "Back to Cart" link

3. **Payment Method**
   - Progress indicator (Step 2 of 3)
   - Order summary sidebar (items, shipping, tax, total)
   - Payment options (credit card, PayPal, Apple Pay)
   - Credit card form (number, expiry, CVV, name)
   - Billing address (same as shipping checkbox)
   - "Place Order" CTA
   - Security badges (SSL, PCI compliant)

4. **Order Confirmation**
   - Success message with order number
   - Estimated delivery date
   - Order details summary
   - What happens next (email confirmation, tracking)
   - "Continue Shopping" or "View Order" CTA
   - "Create Account" option (if guest checkout)

### Step 3 — Cart component design

**Cart item card:**
```
┌─────────────────────────────────────┐
│ [Image] Product Name                │
│ 80×80   Color: Black, Size: M       │
│         $49.99                      │
│         [-] 1 [+]  [Remove]        │
└─────────────────────────────────────┘
```

**Cart summary:**
```
Subtotal:         $99.98
Shipping:         $5.00
Tax:              $8.75
─────────────────────────
Total:            $113.73
```

### Step 4 — Form design best practices

**Field organization:**
- Group related fields (shipping address together)
- Single-column layout on mobile
- Two-column on desktop where logical (first/last name)
- Required fields marked with asterisk
- Optional fields labeled "(optional)"

**Validation:**
- Real-time validation on blur (not on every keystroke)
- Inline error messages below field
- Green checkmark for valid fields (optional)
- Clear error state (red border, icon, message)
- Disable submit until form valid

**Autofill support:**
- Use proper autocomplete attributes
- Standard field names for browser autofill
- Support address autocomplete APIs (Google Places optional)

### Step 5 — Progress indicator

**Multi-step progress:**
```
1. Cart ━━━━━━ 2. Shipping ━━━━━━ 3. Payment ━━━━━━ 4. Confirm
   ✓                                                        
```

**Visual states:**
- Completed: Green checkmark
- Current: Highlighted, larger
- Upcoming: Muted, smaller

**Mobile:** Simplify to "Step 2 of 4"

### Step 6 — Payment form security

**Trust signals:**
- SSL/secure badge in header
- "Your payment info is encrypted and secure"
- PCI compliance badge
- Money-back guarantee
- Accepted payment logos

**Credit card form:**
- Card number: auto-format with spaces (1234 5678 9012 3456)
- Expiry: MM/YY format, auto-slash
- CVV: 3-4 digits, what is this? tooltip
- Card type detection (Visa/MC logo appears)

**Alternative payment methods:**
- PayPal button (real button styling)
- Apple Pay (if Safari/iOS)
- Google Pay (if Chrome/Android)
- Buy Now, Pay Later options (Affirm, Klarna)

### Step 7 — Order review sidebar

**Always visible summary (desktop):**
- Sticky sidebar on right
- Collapsible on mobile
- Shows: items (count), shipping, tax, total
- Update dynamically as changes made

**Mobile:** Expandable summary at top

### Step 8 — Confirmation page

**Success message:**
```
✓ Order Confirmed!
Order #12345

Thank you, [Customer Name]!

Your order has been placed and will be 
delivered by Wednesday, June 28.

We've sent a confirmation email to [email].
```

**What's included:**
- Order summary (items, shipping, total)
- Shipping address
- Estimated delivery
- Payment method (last 4 digits)
- Order tracking link (if available immediately)

**Next steps:**
- "Track Your Order" button
- "Continue Shopping" button
- "Create Account" (if guest) to save order history

### Step 9 — Mobile optimization

**Cart page:**
- Stack items vertically
- Larger touch targets for +/- buttons
- Sticky "Checkout" button at bottom

**Forms:**
- Full-width inputs
- Large input height (48px minimum)
- Proper input types (email, tel, number)
- Native dropdowns for country/state

**Payment:**
- Stack payment options vertically
- Large radio buttons for selection
- Simplified card form (minimal fields visible)

### Step 10 — Error handling

**Common errors:**
- Out of stock: Show immediately in cart
- Invalid promo code: "Code not found" inline message
- Failed payment: Clear message, try again option
- Shipping unavailable: Suggest alternative address
- Session timeout: Save cart, easy recovery

**Error message template:**
```
⚠ [Error Title]
[Explanation of what went wrong]
[What user should do next]
```

### Step 11 — Empty cart state

If cart is empty:
```
🛒 Your cart is empty

Start adding items to see them here.

[Continue Shopping]
```

**Don't show:** Full checkout UI if cart empty

### Step 12 — Abandonment recovery hints

**Exit intent (optional):**
- "Wait! Get 10% off your first order"
- Only show once per session
- Easy to dismiss

**Save cart:**
- If user has account/email, save cart
- Email reminder after 24 hours (backend feature)
- "You left items in your cart" recovery

## Visual rules

**Layout:**
- Desktop: 2-column (form left 60%, summary right 40%)
- Mobile: Single column, summary expandable
- Max width: 1200px, centered

**Forms:**
- Input height: 48px minimum
- Label above field, 14px, medium weight
- Placeholder for example format
- Error text: 13px, red, below field

**Buttons:**
- Primary CTA: Full-width on mobile, right-aligned desktop
- Height: 48-56px
- Clear label: "Continue to Shipping" (not "Next")

**Colors:**
- Use design system for CTAs
- Green for success states, checkmarks
- Red for errors, warnings
- Neutral for form fields

**Typography:**
- Step headings: 24-28px, bold
- Field labels: 14px, medium
- Input text: 16px (prevent zoom on iOS)
- Summary: Monospace for prices

## Anti-patterns

❌ Requiring account creation before checkout  
❌ Surprise shipping costs at end  
❌ Too many form fields (keep minimal)  
❌ No guest checkout option  
❌ Unclear error messages  
❌ No mobile optimization  
❌ Missing progress indicator  
❌ Distracting from checkout goal  

## Testing checklist

□ Cart updates: add/remove/quantity change works  
□ Form validation: catches all error cases  
□ Mobile: all fields accessible, keyboard doesn't hide inputs  
□ Payment: card formatting works  
□ Confirmation: shows correct order details  
□ Empty cart: handled gracefully  
□ Back button: navigates correctly  

## Example HTML structure

```html
<div class="checkout-container">
  <!-- Progress indicator -->
  <div class="progress-steps">...</div>
  
  <div class="checkout-layout">
    <!-- Main form area -->
    <main class="checkout-main">
      <h1>Shipping Information</h1>
      <form class="checkout-form">
        <!-- Form fields -->
      </form>
    </main>
    
    <!-- Order summary sidebar -->
    <aside class="order-summary">
      <h2>Order Summary</h2>
      <!-- Cart items and totals -->
    </aside>
  </div>
</div>
```

## Conversion optimization

**Reduce friction:**
- Auto-fill from saved addresses
- Express checkout buttons (Apple Pay, PayPal)
- Guest checkout option
- Minimal required fields

**Build trust:**
- Security badges visible
- Clear return policy link
- Customer service contact
- Professional design

**Speed:**
- Fast page loads
- Instant validation feedback
- Optimistic UI updates
- Loading states during submission
