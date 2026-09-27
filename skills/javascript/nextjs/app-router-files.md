---
name: App Router file conventions
description: App Router special-file defects — error.tsx scope, reset() vs retry(), generic production error messages, global-error requirements, parallel-route default.tsx, persistent layouts and loading.tsx that cannot cover layout data.
priority: 60
activation:
  files:
    - "**/app/**/{layout,template,loading,error,global-error,not-found,default}.{js,jsx,ts,tsx}"
    - "**/app/**/@*/**"
sources:
  - https://nextjs.org/docs/app/api-reference/file-conventions/error
  - https://nextjs.org/docs/app/api-reference/file-conventions/layout
  - https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes
  - https://nextjs.org/docs/app/guides/upgrading/version-16
---
- **error.tsx scope**: it wraps the segment's page and children but not the same segment's `layout.tsx`/`template.tsx` → layout errors skip it. Fix: an `error.tsx` in the parent; `global-error.tsx` for the root layout.
- **reset() does not refetch**: `reset()` re-renders the children on the client without fetching server data again → the same error returns. Fix: `retry()` (`unstable_retry` in 16.2, stable in 16.3) or `router.refresh()` then reset.
- **Relying on error.message**: Server Component errors reach `error.tsx` in production as a generic message plus `digest` → UI branching on message text breaks. Fix: return expected errors as values; log by digest.
- **global-error.tsx**: must be a Client Component rendering its own `<html>`/`<body>`; it replaces the root layout, so global styles, fonts, providers and `metadata` exports are absent.
- **Parallel slot without default.tsx**: an `@slot` missing `default` → 404 on hard navigation or refresh (up to 15) and a failed build in 16. Fix: `default.tsx` returning `null` or calling `notFound()`.
- **Layouts persist**: layouts don't re-render or remount on navigation, so their state, effects and fetched data stay stale across child routes. Fix: `template.tsx` or keyed children for per-navigation resets.
- **loading.tsx can't cover the layout**: uncached data or `cookies()` read in a layout blocks navigation because `loading.tsx` sits below it. Fix: wrap that part in its own `<Suspense>` or move it into the page.
