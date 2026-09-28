---
name: Focus visibility and management
description: Focus failures — outlines removed without replacement, focus lost when elements unmount, SPA route changes that leave focus behind, focus hidden by sticky UI, unexpected autofocus and hidden panels still in the tab order.
priority: 56
tags: [WCAG-2.4.7, WCAG-2.4.3, WCAG-2.4.11, WCAG-3.2.1]
activation:
  content:
    - 'outline(?:-style|-width)?\s*:\s*(?:none|0)\b|:focus\b|:focus-visible\b'
    - '\.focus\(\)|\.blur\(\)|\bautoFocus\b|\bautofocus\b|\bcdkTrapFocus\b|\bfocus-trap\b'
    - 'position\s*:\s*(?:sticky|fixed)|\bscroll-padding|\binert\b'
  examples:
    - 'button:focus { outline: none; }'
    - 'inputRef.current.focus();'
    - '.header { position: sticky; top: 0; }'
sources:
  - https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html
  - https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
  - https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html
  - https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inert
---
- **Invisible focus**: `outline: none`/`0` (resets, component libraries) with no replacement → keyboard users lose their position (2.4.7). Fix: a `:focus-visible` style with ≥ 3:1 contrast.
- **Focus lost on unmount**: removing or re-rendering the focused element (closing a menu, deleting a row, re-filtered lists) → focus drops to `<body>`; the next Tab starts at the top. Fix: move focus to a logical target (`tabindex="-1"`) first.
- **Route changes**: client-side navigation leaves focus on the clicked link and announces nothing → screen-reader users don't know the page changed. Fix: focus the new `h1`/`main` or announce the title.
- **Obscured focus**: sticky headers/footers, cookie banners or chat widgets covering the focused element (2.4.11 AA). Fix: `scroll-padding-top/bottom` matching sticky heights; non-covering banners.
- **Unexpected autofocus**: `autofocus` on page load or focus moved on change/timer → skipped content, mobile keyboard pops up, context change (3.2.1). Fix: autofocus only in dialogs and single-purpose screens.
- **Hidden panels still focusable**: closed drawers, off-canvas menus or carousel slides hidden with `transform`/`opacity`/`height: 0` → Tab lands on invisible controls. Fix: `inert`, `hidden` or `visibility: hidden` when closed.
