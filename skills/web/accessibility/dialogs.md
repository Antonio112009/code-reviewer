---
name: Modal dialogs
description: Modal dialog failures — focus not moved into the dialog, Tab escaping behind it, no Escape or focus return, <dialog open> instead of showModal() and dialogs without an accessible name.
priority: 56
tags: [WCAG-2.1.2, WCAG-2.4.3, WCAG-4.1.2]
activation:
  content:
    - '<dialog\b|\bshowModal\(|\baria-modal\b'
    - '\brole\s*=\s*[{''"]*(?:dialog|alertdialog)\b'
    - '<(?:Modal|Dialog|Drawer|Sheet|Popup|Lightbox)\b'
  examples:
    - 'dialogRef.current.showModal();'
    - '<div role="alertdialog">'
    - '<Modal isOpen={isOpen} onClose={close}>'
sources:
  - https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
  - https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog
---
- **Focus not moved in**: opening a custom modal leaves focus on the trigger → keyboard and screen-reader users keep operating the page behind the overlay. Fix: focus the first field or the heading on open (`showModal()` does it).
- **Focus escapes**: Tab reaches page content behind the modal (no trap, background not `inert`); `aria-modal="true"` alone blocks nothing → users act on hidden content. Fix: native `showModal()`, or `inert` on siblings plus a focus trap.
- **No Escape, no return**: the modal ignores Esc, or closing doesn't return focus to the element that opened it → users are dumped at the page top. Fix: handle Esc; restore focus to the opener (native `<dialog>` does both).
- **`<dialog open>`**: rendering `<dialog open>` or toggling the `open` attribute instead of `showModal()`/`close()` → a non-modal dialog: no top layer, interactive background, no Esc. Fix: call `showModal()`.
- **Unnamed dialog**: no `aria-labelledby`/`aria-label` → announced only as "dialog". Fix: reference the dialog's heading.
