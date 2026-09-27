---
name: Effects and stale closures
description: useEffect / useLayoutEffect defects — stale or unstable dependencies, missing cleanup, async effect callbacks, fetch races, derived state and event logic placed in effects.
priority: 65
tags: [CWE-362, CWE-401]
activation:
  content: ["\\buse(?:Layout|Insertion)?Effect\\s*\\("]
sources:
  - https://react.dev/reference/react/useEffect
  - https://react.dev/learn/you-might-not-need-an-effect
  - https://react.dev/learn/synchronizing-with-effects
  - https://legacy.reactjs.org/blog/2020/08/10/react-v17-rc.html
---
- **Stale or suppressed deps**: the effect reads props, state or functions missing from its deps (often behind an `exhaustive-deps` disable) → it runs with old values. Fix: add them; non-reactive reads via `useEffectEvent` (19.2+).
- **Unstable deps**: objects, arrays or functions created during render as deps, or the effect setting state it depends on → runs every render: refetch storms, infinite loops. Fix: primitive deps, create inside the effect.
- **Missing cleanup**: listeners, intervals, subscriptions, observers or sockets without a returned teardown → leaks and duplicated handlers after remounts, StrictMode and `<Activity>` hide/show.
- **Async effect callback**: `useEffect(async () => …)` returns a Promise instead of a cleanup → the cleanup never runs. Fix: call an inner async function.
- **Fetch race**: requests keyed on changing props/state without `AbortController` or an `ignore` flag → an older response overwrites the newer one. Fix: abort or ignore stale results in the cleanup.
- **Derived state via effect**: `useEffect(() => setFull(a + b), [a, b])` → an extra render that shows stale data first. Fix: compute during render or `useMemo`.
- **Event logic in effects**: POSTs, payments, analytics or navigation triggered by an effect watching state → re-fire on remount, StrictMode, Activity re-show or unrelated dep changes. Fix: run them in the handler.
- **Ref read in cleanup**: cleanup reads `ref.current` → it may already point elsewhere or be `null` (cleanups run asynchronously since React 17). Fix: copy it to a local inside the effect.
