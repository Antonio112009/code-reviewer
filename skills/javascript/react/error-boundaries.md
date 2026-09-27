---
name: Error boundaries
description: Error boundary gaps — error sources boundaries never catch, fallbacks without reset, a single root boundary, side effects in getDerivedStateFromError, hook-based pseudo-boundaries and React 19 error-reporting changes.
priority: 58
activation:
  content:
    - "\\b(?:componentDidCatch|getDerivedStateFromError)\\b"
    - "\\bErrorBoundary\\b"
    - "\\bon(?:Caught|Uncaught|Recoverable)Error\\b"
    - "\\bshowBoundary\\b"
sources:
  - https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
  - https://react.dev/blog/2024/04/25/react-19-upgrade-guide
  - https://react.dev/reference/react-dom/client/createRoot
---
- **Uncaught error sources**: boundaries catch render, lifecycle and effect errors (plus failed Actions and `use()`), not event handlers, timers, promise callbacks or code after an `await` → no fallback, unhandled rejections. Fix: try/catch into state, or `showBoundary`.
- **No reset**: a fallback without `resetKeys`, a `key` tied to the route/entity or a retry → the UI stays broken after navigating or fixing input. Fix: reset on route or data change.
- **Single root boundary**: one boundary around the whole app → any widget error blanks everything. Fix: boundaries around independent regions (routes, panels, widgets).
- **Side effects in getDerivedStateFromError**: logging or other effects there (it runs during render) → duplicated reports. Fix: log in `componentDidCatch`; errors thrown by the fallback itself go to the next boundary up.
- **Hook-based pseudo-boundaries**: try/catch around JSX or hooks in a function component cannot catch child render errors. Fix: a class boundary or react-error-boundary.
- **React 19 reporting**: render errors are no longer re-thrown — uncaught go to `window.reportError`, caught to `console.error` → reporting that relied on re-thrown errors misses them. Fix: `createRoot(el, { onCaughtError, onUncaughtError })`.
