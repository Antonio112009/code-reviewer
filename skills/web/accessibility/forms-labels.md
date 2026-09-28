---
name: Form labels and errors
description: Form accessibility failures — unlabelled or mislabelled controls, placeholder-only labels, validation errors not tied to fields, required/invalid state shown only by colour and radio/checkbox groups without a group label.
priority: 56
tags: [WCAG-1.3.1, WCAG-3.3.1, WCAG-3.3.2, WCAG-1.4.1]
activation:
  content:
    - '<(?:input|select|textarea|label|fieldset|legend)\b'
    - '\bhtmlFor\b|\bplaceholder\s*='
    - '\baria-(?:invalid|describedby|errormessage|required)\b'
  examples:
    - '<input id="email" name="email" />'
    - '<label htmlFor="email">Email</label>'
    - '<input aria-invalid="true" aria-describedby="email-error" />'
sources:
  - https://www.w3.org/WAI/tutorials/forms/
  - https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html
  - https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html
  - https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
---
- **Unlabelled controls**: inputs/selects without `<label for>`, a wrapping label or `aria-labelledby`, or `for`/`htmlFor` pointing at a wrong or duplicated `id` (components rendered twice) → announced as "edit text", click-to-focus broken. Fix: unique ids and real labels.
- **Placeholder as label**: placeholder-only fields → the label disappears while typing, has low contrast and is not reliably announced. Fix: visible label; placeholder only for examples.
- **Errors not tied to fields**: messages rendered near a field without `aria-describedby`/`aria-errormessage` and `aria-invalid="true"` → screen readers don't say what failed (3.3.1). Fix: link the message; focus the first invalid field or an error summary.
- **Colour-only cues**: required or invalid state shown only by a red border or coloured asterisk → invisible to colour-blind users (1.4.1). Fix: text or icon plus the `required` attribute.
- **Ungrouped choices**: radio/checkbox groups without `<fieldset><legend>` (or `role="radiogroup"` with a label) → options read without the question. Fix: group with a legend.
