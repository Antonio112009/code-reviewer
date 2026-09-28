---
name: React DOM events and portals
description: React event-system traps — portal events bubbling to React parents, passive wheel/touch handlers, native versus delegated propagation, non-bubbling onScroll, per-keystroke onChange and bubbling focus events.
priority: 55
activation:
  content:
    - "\\bcreatePortal\\s*\\("
    - "\\b(?:stopPropagation|preventDefault)\\s*\\("
    - "\\bon(?:Wheel|TouchStart|TouchMove|Scroll|Blur)=\\{"
  examples:
    - "createPortal(<Menu />, document.body)"
    - "e.stopPropagation();"
    - "<div onWheel={handleWheel} onTouchStart={handleTouchStart}>"
sources:
  - https://react.dev/reference/react-dom/createPortal
  - https://react.dev/reference/react-dom/components/common
  - https://legacy.reactjs.org/blog/2020/08/10/react-v17-rc.html
  - https://github.com/facebook/react/blob/main/CHANGELOG.md
---
- **Portal events reach React parents**: clicks and keys inside a `createPortal` modal or menu bubble to `onClick`/`onKeyDown`/`onSubmit` of React ancestors though the DOM lives elsewhere → row selection, outside-click closing or submits fire. Fix: stop propagation at the portal root.
- **Passive wheel/touch**: `onWheel`, `onTouchStart` and `onTouchMove` are passive listeners (React 17+) → `e.preventDefault()` is ignored and zoom/scroll locking fails. Fix: `addEventListener(…, { passive: false })` in an effect.
- **Native vs delegated propagation**: React listens on the root container (17+): native listeners on inner nodes run first and their `stopPropagation` swallows React `onClick`; React `stopPropagation` cannot stop them. Fix: one event system per interaction.
- **onScroll doesn't bubble** (17+): a parent `onScroll` never sees a child container scrolling. Fix: attach it to the element that scrolls.
- **Per-keystroke onChange**: React `onChange` fires on every input (native `input` event), not on blur → validation, API calls or heavy filtering per keystroke. Fix: debounce, or `onBlur` for commit logic.
- **Bubbling focus events**: `onFocus`/`onBlur` bubble (focusin/focusout) → parent handlers fire on focus moves between children; "blur means left the widget" logic breaks. Fix: `e.currentTarget.contains(e.relatedTarget)`.
