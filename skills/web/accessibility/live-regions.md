---
name: Status messages and live regions
description: Dynamic updates screen-reader users never hear — live regions mounted together with their message, visual-only status changes, assertive overuse, hidden or re-created regions and toasts that disappear too fast.
priority: 52
tags: [WCAG-4.1.3, WCAG-2.2.1]
activation:
  content:
    - '\baria-(?:live|atomic|relevant|busy)\b'
    - '\brole\s*=\s*[{''"]*(?:alert|status|log|progressbar|timer)\b'
    - '\b(?:toast|snackbar|[Tt]oaster|[Nn]otistack|sonner)\b'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions
  - https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
  - https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html
---
- **Region mounted with its message**: live region rendered at the same moment as its text (`{error && <div role="alert">…}`, a new container per toast) → often not announced. Fix: keep an empty region mounted; change its text later.
- **Visual-only status**: async results (saved, added to cart, N results, upload finished, submit errors) shown only visually → no feedback for screen-reader users (4.1.3 AA). Fix: `role="status"`/`aria-live="polite"`; `role="alert"` for errors.
- **Assertive overuse**: `aria-live="assertive"`/`role="alert"` for routine or rapidly changing content (timers, live search counts) → speech constantly interrupted. Fix: polite and debounced.
- **Hidden regions**: live regions toggled with `display: none`, `hidden` or `aria-hidden` → updates dropped. Fix: keep the region rendered; hide visually with a screen-reader-only class.
- **Re-created regions**: frameworks replacing the region node on each update (changing `key`, conditional wrappers) → announcements lost or repeated. Fix: stable element; set `aria-atomic="true"` when the whole message matters.
- **Toasts that vanish**: auto-dismissing messages with actions (Undo, Retry) or important text after a few seconds (2.2.1) → can't be read or reached. Fix: persist until dismissed or allow extending; focusable actions.
