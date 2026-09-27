---
name: useEffectEvent misuse
description: useEffectEvent (React 19.2+) pitfalls — Effect Events called outside effects, passed to other components or hooks, listed in dependencies, used to hide reactive values, or imported on older React versions.
priority: 63
activation:
  content: ["\\buseEffectEvent\\b"]
sources:
  - https://react.dev/reference/react/useEffectEvent
  - https://react.dev/blog/2025/10/01/react-19-2
  - https://github.com/facebook/react/blob/main/CHANGELOG.md
---
- **Called outside effects**: an Effect Event invoked during render, from JSX event handlers or from other hooks → lint and runtime errors. Fix: a plain function or `useCallback` for handlers.
- **Passed down or stored**: Effect Events passed as props, returned from custom hooks, put in context or refs → invoked outside the owning component's effects. Fix: keep them local to that component's effects.
- **Listed in deps**: an Effect Event in a dependency array → the effect re-runs every render because its identity changes on purpose. Fix: omit it.
- **Hiding reactive values**: logic that must re-trigger the effect (`roomId` for a connection, `url` for a page-view log) moved into an Effect Event → changes no longer re-run the effect. Fix: keep such values as deps.
- **Version gaps**: `react` exports `useEffectEvent` only from 19.2 (earlier only `experimental_useEffectEvent` in canaries) → `undefined` import and TypeError on older versions; in 19.2.x it could read stale values inside `memo`/`forwardRef` components (fixed in 19.3).
