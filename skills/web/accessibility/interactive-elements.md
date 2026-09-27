---
name: Interactive elements and keyboard
description: Keyboard-inoperable UI — clickable divs/spans, custom roles without keyboard support or state, links used as buttons (and vice versa), composite widget roles without arrow-key handling, positive tabindex, nested controls and aria-disabled that still acts.
priority: 60
tags: [WCAG-2.1.1, WCAG-4.1.2]
activation:
  content:
    - '\b(?:onClick|onclick|v-on:click|on:click)\s*=|@click\b|\(click\)\s*='
    - '\brole\s*=\s*[{''"]*(?:button|link|checkbox|radio|switch|tab|menuitem|option|menu|menubar|tablist|listbox|grid|tree|combobox)\b'
    - 'href\s*=\s*[{''"]*(?:#[''"]|javascript:)'
    - '\btab[iI]ndex\s*=\s*[{''"]*[1-9]|\baria-disabled\b'
sources:
  - https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html
  - https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
  - https://www.w3.org/WAI/ARIA/apg/patterns/button/
  - https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html
---
- **Clickable non-controls**: `div`, `span`, `li`, `img`, `svg` or table rows with click handlers (`onClick`, `@click`, `(click)`, `on:click`) → unreachable by keyboard, not announced as actionable. Fix: `<button type="button">`/`<a href>`; else `role`, `tabindex="0"`, Enter/Space handling.
- **Roles without behaviour**: `role="button|checkbox|switch|tab|menuitem"` lacking `tabindex="0"`, key handlers or state (`aria-pressed/checked/selected`) → announced but inoperable. Fix: native element or the full APG pattern.
- **Links vs buttons**: `<a>` without `href` (not focusable), `href="#"`/`javascript:void(0)` running actions, buttons that navigate → broken keyboard/AT behaviour. Fix: links navigate, buttons act.
- **Composite roles without keys**: `menu`, `tablist`, `listbox`, `grid`, `tree`, `combobox` without arrow keys and roving `tabindex`/`aria-activedescendant` → items unreachable. Fix: APG pattern, or plain lists of links for site navigation.
- **Positive tabindex**: `tabindex` ≥ 1 → tab order diverges from visual order (2.4.3). Fix: `0`/`-1` and DOM order.
- **Nested interactive**: buttons/links inside `<a>`/`<button>`, clickable cards wrapping controls → invalid HTML, double activation, unreachable inner controls. Fix: separate controls, stretched-link pattern.
- **aria-disabled still acts**: `aria-disabled="true"` without guarding handlers → still fires on click/Enter. Fix: early return.
