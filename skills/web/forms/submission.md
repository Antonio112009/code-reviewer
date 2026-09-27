---
name: Form submission
description: Native form submission defects — buttons that submit by default, form.submit() bypassing validation and submit handlers, missing preventDefault or method, double submits, disabled and unchecked fields missing from the payload, and implicit Enter submission.
priority: 58
activation:
  content:
    - '<form\b|<button\b'
    - '\bonSubmit\b|@submit\b|\(ngSubmit\)|\(submit\)|\bon:submit\b|\bonsubmit\b'
    - '\.submit\(\)|\brequestSubmit\(|\bnew FormData\('
sources:
  - https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/button
  - https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/submit
  - https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/disabled
  - https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constructing-the-form-data-set
---
- **Buttons that submit**: `<button>` without `type` inside a `<form>` defaults to `type="submit"` → "Cancel", "Add row" or "Show password" buttons submit the form. Fix: `type="button"` on every non-submit button.
- **`form.submit()` bypass**: calling `form.submit()` skips constraint validation and the `submit` event (your handlers, analytics, token injection) → invalid or unprotected submissions. Fix: `form.requestSubmit()`.
- **Native fallback leaks**: JS submit handlers that forget `preventDefault()`, or forms without `method="post"` submitted before scripts load → full reload and a GET with every field (passwords too) in the URL, history and logs. Fix: `method="post"`, prevent default in handlers.
- **Double submits**: submit controls not disabled or guarded while a request is pending, Enter pressed twice → duplicate orders or payments. Fix: pending state plus an idempotent endpoint.
- **Missing fields**: `disabled` inputs are excluded from submission and `FormData`, unchecked checkboxes send nothing → server reads null/false or keeps stale values. Fix: `readonly` for fixed values; explicit defaults server-side.
- **Implicit Enter submission**: Enter in a text field submits the form (e.g. a search or tag input inside a larger form) → premature submission. Fix: separate forms or handle Enter explicitly.
