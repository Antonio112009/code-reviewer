---
name: Suspense, use() and lazy
description: Suspense data-loading defects — uncached promises passed to use(), use() inside try/catch, lazy() in render, badly placed boundaries, fallbacks replacing visible content and use(browser()) without a boundary.
priority: 60
activation:
  content:
    - "<Suspense\\b"
    - "\\buse\\s*\\("
    - "\\blazy\\s*\\("
    - "\\bbrowser\\s*\\(\\s*\\)"
  examples:
    - "<Suspense fallback={<Spinner />}>{children}</Suspense>"
    - "const Chart = lazy(() => import('./Chart'));"
    - "const win = use(browser());"
sources:
  - https://react.dev/reference/react/use
  - https://react.dev/reference/react/Suspense
  - https://react.dev/reference/react/lazy
  - https://react.dev/blog/2026/09/09/react-19-3
---
- **Uncached promise**: `use(fetch(url))` or a promise created during a Client Component render → a new promise every render: endless suspending and refetching ("uncached promise" warning). Fix: create it in a Server Component/loader or cache it by key.
- **use() in try/catch**: wrapping `use()` in try/catch, or reading `promise.status` to skip it, breaks Suspense. Fix: an Error Boundary for rejections (without one the rejection crashes the tree).
- **lazy() in render**: `const Chart = lazy(() => import('./Chart'))` inside a component → a new component type each render: remounts and lost state. Fix: module scope.
- **Boundary placement**: no `<Suspense>` near a suspending component → the nearest outer boundary (or the root) hides large parts of the page; a single app-wide boundary blanks the layout. Fix: granular boundaries.
- **Fallback replaces visible content**: navigation or filter updates that suspend already shown UI without `startTransition`/`useDeferredValue` → content flashes to a spinner. Fix: transitions; `key` a boundary only to reset on purpose.
- **Effects don't suspend**: data fetched in `useEffect` or handlers never triggers Suspense → no fallback while components render with empty data.
- **use(browser()) (19.3+)**: must run in a Client Component under a `<Suspense>` boundary during SSR; without one server rendering fails.
