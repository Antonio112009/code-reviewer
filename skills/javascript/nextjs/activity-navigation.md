---
name: Preserved route state (Cache Components)
description: Next.js 16 with cacheComponents keeps recently visited routes mounted but hidden via React Activity — state surviving logout, transient UI and stale messages reappearing, media and page styles active in hidden routes, and e2e selectors matching hidden DOM.
priority: 58
activation:
  content:
    - "\\bcacheComponents\\s*:"
    - "\\b(?:signOut|logout|logOut)\\s*\\("
    - "<(?:video|audio|iframe|dialog|style)\\b"
    - "\\bbfcacheId\\b"
  examples:
    - "cacheComponents: true,"
    - "await signOut();"
    - "<video autoPlay muted loop src={heroVideo} />"
    - "const testId = `${bfcacheId}-item`;"
  versions: { framework.nextjs: ">=16" }
sources:
  - https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents
  - https://nextjs.org/docs/app/guides/preserving-ui-state
---
- **State survives logout**: with `cacheComponents: true` up to 3 visited routes stay mounted but hidden; logging out via `router.push('/login')` keeps the previous user's drafts and form state in memory. Fix: full reload (`window.location.href`) or `key` by user ID.
- **Transient UI reappears**: open dropdowns and dialogs, stale success or error messages and filled "new item" forms come back on back-navigation; effects keyed on already-true state don't re-run. Fix: reset in a `useLayoutEffect` cleanup, or derive from the URL.
- **Hidden media and styles**: `<video>`/`<audio>` in a hidden route keeps playing, and page-level `<style>` rules or CSS variables still apply to the visible page. Fix: pause and disable styles in layout-effect cleanups.
- **Effects re-run on return**: hidden routes run effect cleanups and re-run setup when shown again → page-view analytics and one-time initializations fire again. Fix: a ref to tell first mount from re-show.
- **E2E selectors hit hidden DOM**: hidden routes stay in the document with `display: none` → CSS or text selectors match hidden duplicates and clicks time out. Fix: role/label queries or explicit visibility filters.
