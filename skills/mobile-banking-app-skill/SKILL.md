---
name: mobile-banking-app-skill
description: |
  Mobile banking app screen with account overview, transactions, and quick actions.
  For fintech apps, banking interfaces, financial dashboards.
triggers:
  - "banking app"
  - "fintech app"
  - "mobile banking"
  - "financial app"
  - "银行应用"
od:
  mode: prototype
  platform: mobile
  scenario: application
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, typography, components]
  example_prompt: "Create a mobile banking home screen with account balance, recent transactions, quick actions, and bottom navigation."
---

# Mobile Banking App Skill

Create secure, trustworthy mobile banking interface.

## Layout (iPhone Frame)
```
┌────────────────┐
│ ⌚ 9:41  📶 🔋 │ Status bar
├────────────────┤
│ Good morning   │
│ John           │
│                │
│ ┌────────────┐ │ Balance card
│ │ Checking   │ │
│ │ $12,487.50 │ │
│ │ +$250 today│ │
│ └────────────┘ │
│                │
│ Quick Actions  │
│ [Pay][Send]   │
│ [Request][More]│
│                │
│ Recent Trans.  │
│ ● Starbucks    │
│   -$4.50       │
│ ● Salary       │
│   +$5,000      │
│ ...            │
├────────────────┤
│[⌂][📊][+][⚙]│ Bottom nav
└────────────────┘
```

## Key Features

**Balance Card:**
- Account type (Checking/Savings)
- Large balance (prominent)
- Today's change (+ green, - red)
- Masked by default (tap to reveal)
- Gradient or solid background

**Quick Actions:**
- Pay bills
- Send money
- Request payment
- Deposit check (camera)
- 4-6 actions, icon + label

**Transaction List:**
- Merchant name or description
- Amount (right-aligned, monospace)
- Category icon
- Date/time
- Pending badge if applicable
- Tap for details

**Bottom Navigation:**
- Home
- Accounts
- Transfer
- More/Settings
- Active state clear

## Security Considerations

**Visual Trust:**
- Professional design
- No flashy animations
- Clear branding
- Secure badge

**Data Display:**
- Balance masked by default
- Card numbers show last 4
- Biometric prompt UI
- Session timeout warning

**Feedback:**
- Transaction confirmations
- Loading states
- Error messages clear
- Success animations subtle

## Visual Design

**Colors:**
- Professional (blue, navy, green)
- Positive: green
- Negative: red
- Neutral: gray

**Typography:**
- Numbers: Monospace, tabular
- Balance: 32-40px, bold
- Transaction: 16px body
- Amounts: 18px, bold

**Spacing:**
- Comfortable padding (16-20px)
- Card spacing (16px gaps)
- List items (12px vertical)

**Cards:**
- Rounded corners (12-16px)
- Subtle shadow or border
- No heavy effects

## Interactions

**Pull-to-refresh:**
- Update balance and transactions
- Loading indicator

**Swipe actions:**
- Swipe transaction left: categorize, flag
- Swipe right: mark reviewed

**Tap actions:**
- Balance card: toggle mask
- Transaction: view details
- Quick action: open flow

## Accessibility

**Touch targets:**
- Minimum 44×44px
- Comfortable spacing

**Contrast:**
- WCAG AA for all text
- Especially amounts

**Labels:**
- Screen reader descriptions
- Amount announced with currency
- Clear button labels

## States

**Loading:**
- Skeleton for balance
- Shimmer for transactions

**Empty:**
- "No transactions yet"
- Helpful message

**Error:**
- "Can't load balance"
- Retry button
- Support contact

## Trust Signals

- Bank logo prominent
- "Your account is secure" message
- FDIC insured badge
- Encrypted connection icon
