---
name: External stores and selectors
description: useSyncExternalStore, Redux useSelector and Zustand selector defects — uncached snapshots, selectors returning new references (infinite loops in Zustand v5), whole-state selection, resubscribing and missing server snapshots.
priority: 58
activation:
  content:
    - "\\buseSyncExternalStore\\b"
    - "\\buseSelector\\s*\\("
    - "\\buse\\w*Store\\s*\\("
    - "\\buseShallow\\b"
sources:
  - https://react.dev/reference/react/useSyncExternalStore
  - https://react-redux.js.org/api/hooks
  - https://zustand.docs.pmnd.rs/reference/migrations/migrating-to-v5
---
- **Uncached snapshot**: `getSnapshot` returning a new object or array on every call → infinite re-render loop ("The result of getSnapshot should be cached"). Fix: return stored immutable values.
- **Selectors returning new references**: Zustand v5 `useStore(s => ({ a: s.a }))` or `s => [s.a, s.setA]` → "Maximum update depth exceeded"; Redux `useSelector` returning new objects or `map`/`filter` results → re-render per dispatch. Fix: `useShallow`, `shallowEqual`, `createSelector`.
- **Whole-state selection**: `useSelector(s => s)` or a store hook called without a selector → the component re-renders on any change in the store.
- **Resubscribing**: a `subscribe` function defined inside the component → unsubscribes and resubscribes on every render. Fix: module scope or `useCallback`.
- **Missing server snapshot**: `useSyncExternalStore` during SSR without `getServerSnapshot`, or returning a value different from the first client snapshot → error or hydration mismatch.
- **Tearing via effects**: mirroring a mutable external source into state with `useEffect` + `useState` → components show different values in concurrent renders. Fix: `useSyncExternalStore`.
- **Mutating store state**: changing store objects in place outside Immer/RTK reducers → subscribers are not notified, UI goes stale. Fix: immutable updates.
