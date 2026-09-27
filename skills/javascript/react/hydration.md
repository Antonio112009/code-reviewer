---
name: Hydration mismatches
description: Server-rendered React output (Next.js, Remix / React Router, Astro islands) that differs on the client — browser-only reads in render, time/random/locale values, invalid HTML nesting, unstable IDs and blanket suppressHydrationWarning.
priority: 58
activation:
  stack: [framework.nextjs, framework.remix, framework.astro]
  content:
    - "\\btypeof\\s+(?:window|document|navigator)\\b"
    - "\\bsuppressHydrationWarning\\b"
    - "\\bhydrateRoot\\s*\\("
    - "\\b(?:localStorage|sessionStorage|matchMedia)\\b"
    - "\\b(?:toLocale(?:Date|Time)?String|Date\\.now|Math\\.random)\\s*\\("
sources:
  - https://react.dev/reference/react-dom/client/hydrateRoot
  - https://react.dev/reference/react/useId
  - https://nextjs.org/docs/messages/react-hydration-error
---
- **Environment branches in render**: `typeof window` checks, `localStorage`, `matchMedia` or `navigator` read while rendering a server-rendered component → different client markup: slow client re-render or handlers on wrong nodes. Fix: read after mount, `useSyncExternalStore` + `getServerSnapshot`, or `use(browser())` (19.3+).
- **Time, randomness, locale**: `Date.now()`, `new Date()` formatting, `Math.random()`, `toLocaleString()`/`Intl` without explicit `locale` and `timeZone` → the server (often UTC/en-US) disagrees with the browser. Fix: pass values from the server or format after mount.
- **Invalid HTML nesting**: `<div>` or `<p>` inside `<p>`, `<a>` inside `<a>`, `<tr>` without `<tbody>`, nested buttons → the browser repairs the DOM and hydration mismatches. Fix: valid nesting.
- **Unstable IDs**: counters or `Math.random()` for `id`, `htmlFor` or ARIA attributes → mismatched IDs and broken label associations. Fix: `useId()` with identical server and client trees.
- **Blanket suppressHydrationWarning**: it silences only one level (text/attributes) and does not patch content → wrong text stays and real bugs hide. Fix: reserve it for unavoidable values such as timestamps.
