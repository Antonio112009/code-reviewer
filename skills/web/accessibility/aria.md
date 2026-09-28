---
name: ARIA misuse
description: ARIA that hides, misnames or misstates UI — aria-hidden on focusable content, names and roles that are ignored, broken id references, stale state attributes, aria-label contradicting visible text and missing required child roles.
priority: 56
tags: [WCAG-4.1.2, WCAG-2.5.3, WCAG-1.3.1]
activation:
  content:
    - '\baria-[a-z]+'
    - '\brole\s*=\s*[{''"]*[a-z]'
  examples:
    - '<span aria-hidden="true">&times;</span>'
    - '<div role="dialog">'
sources:
  - https://www.w3.org/TR/using-aria/
  - https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-hidden
  - https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-label
  - https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html
---
- **Hidden yet focusable**: `aria-hidden="true"` on a focusable element or an ancestor of one (icon buttons, off-canvas menus, inactive slides, app root behind a modal) → focus lands on "nothing". Fix: `inert`/`hidden`, or remove from the tab order.
- **Ignored names and roles**: `aria-label` on role-less `div`/`span`, `p` or `code` (naming prohibited) → silently dropped; `role="presentation"|"none"` on focusable elements → ignored. Fix: name interactive/landmark elements or use visible text.
- **Broken id references**: `aria-labelledby`, `aria-describedby`, `aria-controls`, `aria-activedescendant` pointing at missing or duplicated ids (reused components, SSR/CSR mismatch, another shadow root) → no name or description. Fix: unique generated ids in the same tree.
- **Stale states**: `aria-expanded`, `aria-pressed`, `aria-selected`, `aria-checked`, `aria-current` hard-coded or not updated with the UI → wrong state announced. Fix: bind to the rendering state.
- **Name contradicts visible label**: `aria-label` not containing the visible text (button "Buy" named "Add item to cart") → speech-input users can't activate it (2.5.3). Fix: start the name with the visible words.
- **Missing required children**: `role="list|listbox|tablist|menu|grid|tree"` whose items lack `listitem`/`option`/`tab`/`menuitem`/`row` roles or sit in extra wrappers → items not recognized. Fix: correct ownership; prefer native elements over re-roled ones.
