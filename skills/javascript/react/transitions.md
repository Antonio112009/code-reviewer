---
name: Transitions and deferred rendering
description: startTransition / useTransition / useDeferredValue / ViewTransition defects — updates after await or in timers not marked as transitions, controlled inputs in transitions, out-of-order async transitions.
priority: 58
activation:
  content:
    - "\\b(?:useTransition|startTransition|useDeferredValue|addTransitionType)\\b"
    - "<ViewTransition\\b"
sources:
  - https://react.dev/reference/react/useTransition
  - https://react.dev/reference/react/useDeferredValue
  - https://react.dev/reference/react/ViewTransition
---
- **Updates after `await`**: in `startTransition(async () => { await save(); setPage(p) })` the update after `await` is not a transition → shown content can fall back to Suspense spinners. Fix: wrap post-await updates in another `startTransition`.
- **Timers inside the scope**: `setTimeout`/promise callbacks created inside `startTransition` are not transitions. Fix: call `startTransition` inside the callback.
- **Controlled input in a transition**: the state behind an input's `value` updated in a transition → typing lags or drops characters. Fix: keep input state urgent, defer the derived value with `useDeferredValue`.
- **Out-of-order async transitions**: overlapping awaited transitions (search, filters, tabs) finish in any order → stale results win. Fix: `useActionState` (queued) or abort/ignore superseded requests.
- **Unstable deferred value**: `useDeferredValue` given a new object or array each render → it never settles and keeps re-rendering in the background. Fix: pass primitives or memoized values.
- **ViewTransition (19.3+)**: only Transition, Suspense and `useDeferredValue` updates animate (plain `setState`/`flushSync` skip); one below a DOM wrapper won't animate enter/exit; two mounted with the same `name` error. Fix: unique names, place it first.
