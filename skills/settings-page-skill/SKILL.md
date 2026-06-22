---
name: settings-page-skill  
description: |
  Comprehensive settings interface with sidebar navigation, form sections,
  save states, and danger zone. For app settings, user preferences, account management.
triggers:
  - "settings page"
  - "preferences"
  - "account settings"
  - "configuration"
  - "设置页面"
od:
  mode: prototype
  platform: desktop
  scenario: application
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  example_prompt: "Create a settings page with sidebar navigation for Profile, Notifications, Security, Billing, and Team sections."
---

# Settings Page Skill

Create an organized settings interface that's easy to navigate and understand.

## Layout Structure

**Desktop:**
```
┌────────────────────────────────────────┐
│ Header                                  │
├────────┬───────────────────────────────┤
│ ☰ Nav  │ Settings Content              │
│ 240px  │                               │
│        │ [Breadcrumb: Settings > Profile]│
│ Profile│                               │
│ Notif. │ [Section: Personal Info]      │
│ Secur. │ [Form fields...]             │
│ Billing│                               │
│ Team   │ [Section: Avatar]             │
│ Integr.│ [Upload area...]             │
│        │                               │
│        │ [Danger Zone]                 │
│        │ [Delete Account]              │
│        │                               │
│        │ [Cancel] [Save Changes]       │
└────────┴───────────────────────────────┘
```

## Navigation Sidebar

**Categories (typical):**
- 👤 Profile
- 🔔 Notifications  
- 🔒 Security
- 💳 Billing
- 👥 Team
- 🔌 Integrations
- ⚙️ Advanced

**States:**
- Active: Highlighted background
- Hover: Subtle background change
- Badge: Show unsaved changes count

## Content Sections

**Section structure:**
```
## Section Title
Brief description of what these settings control.

[Form fields organized in groups]

────────────────────────

## Next Section
...
```

**Form patterns:**
- Label above field
- Help text below (optional)
- Toggle switches for boolean
- Radio/checkbox for choices
- Dropdowns for many options

## Save Behavior

**Auto-save vs Manual:**
- Manual save (recommended for settings)
- "Save Changes" button, disabled until changes made
- "Cancel" reverts to last saved state
- Show "Unsaved changes" warning on navigate away

**Feedback:**
- Success toast: "Settings saved"
- Error toast: "Failed to save. Try again."
- Inline validation on blur

## Danger Zone

**Destructive actions:**
- At bottom of relevant section
- Red border, red button
- Requires confirmation modal
- Examples: Delete account, Reset data, Leave team

**Confirmation modal:**
```
⚠️ Delete Account?

This action cannot be undone. All your data
will be permanently deleted.

Type "DELETE" to confirm:
[_____________]

[Cancel] [Delete Account]
```

## Common Settings Sections

**Profile:**
- Name, email, avatar
- Bio, timezone, language
- Public profile visibility

**Notifications:**
- Email preferences (grouped)
- Push notification settings
- Digest frequency

**Security:**
- Change password
- Two-factor authentication
- Active sessions list
- Connected accounts

**Billing:**
- Current plan card
- Payment method
- Billing history table
- Update/cancel subscription

**Team:**
- Team member list
- Invite new members
- Role management
- Team settings

## Mobile Adaptation

- Nav becomes hamburger menu
- Full-width form fields
- Stack sections vertically
- Sticky save button bar

## Visual Design

**Spacing:**
- Sections: 48px vertical gap
- Form groups: 24px gap
- Fields: 16px gap
- Generous padding in cards

**Typography:**
- Page title: 32px
- Section headings: 20px, bold
- Labels: 14px, medium
- Help text: 13px, muted

**Colors:**
- Use design system
- Danger zone: red background/border
- Success: green toast
- Muted: gray for help text
