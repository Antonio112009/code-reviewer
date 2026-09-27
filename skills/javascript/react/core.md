---
name: React render correctness
description: Render-phase defects in any React component — components created during render, impure renders, side effects and state updates in the render body, and falsy numbers rendered by &&.
priority: 62
sources:
  - https://react.dev/reference/rules/components-and-hooks-must-be-pure
  - https://react.dev/learn/preserving-and-resetting-state
  - https://react.dev/learn/conditional-rendering
---
- **Component created in render**: a component (or `withX(Comp)` HOC result) defined inside another component's body is a new type each render → its subtree remounts, losing state, focus and scroll. Fix: define it at module scope.
- **Impure render**: the body mutates props, state, context values or module variables (`props.items.sort()`, `cache.push()`, counters) → output depends on how often React renders (StrictMode, retries). Fix: copy (`toSorted`) or move to handlers.
- **Side effects in render**: `fetch`, subscriptions, timers, `localStorage` writes, analytics or navigation in the component body → repeated on every render, including discarded ones. Fix: event handlers or effects.
- **setState during render**: an unconditional `setX(...)` in the body → "Too many re-renders". Only a guarded "store previous prop, compare, then set" update is safe.
- **Falsy number in JSX**: `{count && <Badge/>}` or `{list.length && …}` renders a literal `0` (a crash in React Native outside `<Text>`). Fix: `count > 0 &&` or a ternary.
