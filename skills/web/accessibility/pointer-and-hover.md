---
tier: full
name: Pointer, hover and target size
description: WCAG 2.2 pointer failures — hover-only menus and tooltips, hover content that vanishes or cannot be dismissed, actions fired on pointer-down, drag-only interactions and targets below 24×24 CSS px.
priority: 52
tags: [WCAG-1.4.13, WCAG-2.5.2, WCAG-2.5.7, WCAG-2.5.8]
activation:
  content:
    - '\bon(?:MouseDown|mousedown|PointerDown|pointerdown|TouchStart|touchstart|MouseEnter|mouseenter|MouseOver|mouseover)\b'
    - '@(?:mousedown|pointerdown|touchstart|mouseenter|mouseover)\b|\((?:mousedown|pointerdown|touchstart|mouseenter)\)'
    - '\bdraggable\b|\bon(?:Drag\w*|dragstart)\b|\b(?:dnd-kit|react-beautiful-dnd|sortablejs)\b'
    - '\b(?:[Tt]ooltip|popover)\b'
sources:
  - https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html
  - https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html
  - https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
  - https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
---
- **Hover-only content**: menus, tooltips or row actions revealed only on `mouseenter`/`:hover` → unreachable by keyboard and touch. Fix: also show on focus/click (`:focus-within`).
- **Unstable hover content**: tooltips/popovers that close when the pointer moves onto them, can't be dismissed with Esc, or auto-hide on a timer (1.4.13) → magnifier and low-vision users can't read them. Fix: hoverable, Esc-dismissible, persistent.
- **Pointer-down activation**: delete, submit or navigate fired on `mousedown`/`pointerdown`/`touchstart` → no way to cancel by sliding off (2.5.2), accidental triggers while scrolling. Fix: act on `click`/`pointerup`.
- **Drag-only interactions**: reordering, sliders, kanban moves or map panning only by dragging (2.5.7 AA) → impossible for single-pointer and keyboard users. Fix: buttons or menus as alternatives.
- **Small targets**: icon buttons and links under 24×24 CSS px without enough spacing (2.5.8 AA) → mis-taps. Fix: min size or padding (inline text links exempt).
