---
schemaVersion: 1
name: form-layout
description: >
  Lays out forms, onboarding, checkout, settings, and any screen with 3+
  input fields. Enforces single-column layouts, label-above-input, blur-time
  validation, multi-step wizards split at logical seams, and 44px touch
  targets. Use when designing or coding any form-bearing UI.
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## When to use

Trigger this skill for any of:

- Forms with 3 or more input fields (sign-up, contact, profile, billing).
- Multi-step wizards or onboarding flows.
- Checkout flows (cart → address → payment → confirm).
- Settings or preferences screens.
- Any modal or sheet that collects structured input.

## Rules

1. **Single column by default.** Use a single-column layout for forms with 8 or fewer fields. Two columns are only allowed for fields that are obviously paired and read together (first/last name, city/state/ZIP, expiry month/year). Never split unrelated fields side by side.
2. **Labels above inputs.** Place the label on its own line above the input, left-aligned. Never use the placeholder as the label — placeholders disappear on focus and break accessibility.
3. **Placeholder is example data only.** Show the format you expect (`jane@example.com`, `MM/YY`), not a restatement of the label.
4. **Inline validation on blur.** Validate a field when the user leaves it, never on every keystroke. On submit, re-run all validators as a safety net and scroll the first error into view.
5. **Multi-step wizards split at logical seams.** Account info → shipping → payment → confirm. Keep each step ≤ 7 fields. Show a persistent progress indicator (steps + current position) at the top of every step.
6. **44 px minimum touch target on mobile.** Inputs, buttons, and tap-able rows must be ≥ 44 px tall on mobile viewports.
7. **Required-field indicator: pick one and stay consistent.** Either an asterisk after every required label or an explicit "(required)" suffix. Do not mix the two within a project.
8. **Never ask for the same data twice.** Provide a "Same as shipping address" toggle. Pre-fill from social-login profile data, address autocomplete, or saved payment methods whenever available.

## Do / Don't

**Do**
- Stack labels above inputs.
- Trigger validation on `blur` and again on submit.
- Group related fields into a `<fieldset>` with a `<legend>`.
- Disable the submit button only after the user has interacted; otherwise show the error inline.
- Allow paste in OTP, password, and verification fields.

**Don't**
- Don't put labels inside inputs as placeholders.
- Don't validate on every keystroke (annoying), unless it's password strength meter feedback.
- Don't disable the submit button by default — users can't tell why nothing happens.
- Don't auto-advance focus between fields unless the field has a fixed width (OTP digits).
- Don't surface "Please fill out this field" on a field the user hasn't touched.

## Code patterns

Single-column form scaffold:

```html
<form class="grid gap-4 max-w-md">
  <div class="grid gap-1.5">
    <label for="email" class="text-sm font-medium">Email <span aria-hidden="true">*</span></label>
    <input id="email" name="email" type="email" required
           placeholder="jane@example.com"
           class="h-11 px-3 rounded-md border" />
    <p class="text-xs text-red-600 hidden" data-error="email"></p>
  </div>

  <div class="grid grid-cols-2 gap-3">
    <div class="grid gap-1.5">
      <label for="first" class="text-sm font-medium">First name *</label>
      <input id="first" name="first" required class="h-11 px-3 rounded-md border" />
    </div>
    <div class="grid gap-1.5">
      <label for="last" class="text-sm font-medium">Last name *</label>
      <input id="last" name="last" required class="h-11 px-3 rounded-md border" />
    </div>
  </div>

  <button type="submit" class="h-11 rounded-md bg-blue-600 text-white">Continue</button>
</form>
```

Blur-time validation hook:

```ts
input.addEventListener('blur', () => {
  const error = validate(input.value);
  errorEl.textContent = error ?? '';
  errorEl.classList.toggle('hidden', !error);
  input.setAttribute('aria-invalid', error ? 'true' : 'false');
});
```

Wizard progress indicator:

```tsx
<ol className="flex items-center gap-2 text-xs">
  {steps.map((step, i) => (
    <li key={step.id} className={i === current ? 'font-semibold' : 'text-muted-foreground'}>
      {i + 1}. {step.label}
    </li>
  ))}
</ol>
```
