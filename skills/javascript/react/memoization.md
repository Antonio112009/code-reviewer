---
name: Memoization
description: useMemo / useCallback / memo defects — memoization defeated by unstable inputs, unsafe custom comparators, stale memoized callbacks and code that relies on memoization for correctness.
priority: 58
activation:
  content: ["\\buse(?:Memo|Callback)\\s*\\(", "\\bmemo\\s*\\("]
sources:
  - https://react.dev/reference/react/memo
  - https://react.dev/reference/react/useMemo
  - https://react.dev/reference/react/useCallback
---
- **Unstable deps**: deps contain objects, arrays or functions created during render → recomputed every render, so `useMemo`/`useCallback` only add cost. Fix: memoize the inputs or create them inside.
- **memo defeated by props**: inline objects, arrays, callbacks or JSX `children` passed to a `memo` component → it re-renders every time. Fix: stabilize those props.
- **Unsafe comparator**: `memo(C, areEqual)` skipping callback props or comparing only some fields → stale closures and outdated UI; `JSON.stringify` deep compares freeze the UI. Fix: shallow-compare every prop.
- **Stale memoized callbacks**: `useCallback`/`useMemo` with missing deps (often lint-suppressed) → handlers read values from an old render. Fix: correct deps, updater functions or `useEffectEvent` inside effects.
- **Memoization for correctness**: relying on `useMemo` to run once (creating instances, subscribing, side effects) → React may drop the cache and StrictMode calls it twice. Fix: `useState(() => …)` or a lazily initialized ref.
