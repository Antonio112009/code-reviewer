---
name: Next.js navigation control flow
description: redirect / notFound / forbidden / unauthorized and client-router defects — control-flow errors swallowed by try/catch or error boundaries, caught prerender bailouts, open redirects via redirect(), redirect() in event handlers and useSearchParams client-rendering bailouts.
priority: 64
tags: [CWE-601]
activation:
  content:
    - "\\b(?:redirect|permanentRedirect|notFound|forbidden|unauthorized)\\s*\\("
    - "\\bunstable_rethrow\\b"
    - "\\buse(?:Router|SearchParams)\\s*\\("
    - "['\"]next/(?:navigation|router)['\"]"
  examples:
    - "redirect('/login');"
    - "unstable_rethrow(err);"
    - "const searchParams = useSearchParams();"
    - "import { redirect } from 'next/navigation';"
sources:
  - https://nextjs.org/docs/app/api-reference/functions/redirect
  - https://nextjs.org/docs/app/api-reference/functions/unstable_rethrow
  - https://nextjs.org/docs/app/api-reference/functions/use-search-params
  - https://nextjs.org/blog/next-16-3
---
- **Swallowed control flow**: `redirect()`, `notFound()`, `forbidden()` or `unauthorized()` called inside `try` (directly or in a helper) → the catch intercepts the thrown signal and navigation never happens. Fix: call after the try, or `unstable_rethrow(err)` first in the catch.
- **Caught prerender bailouts**: during prerendering `cookies()`, `headers()`, `searchParams` and `no-store` fetches throw internal errors Next.js must see; a surrounding try/catch swallows them → wrong static/dynamic decisions or build errors. Fix: `unstable_rethrow(err)` first in the catch.
- **Boundaries eat redirects**: a custom class Error Boundary around code calling `redirect()`/`notFound()` renders its fallback instead of navigating. Fix: rethrow them; on 16.3+ `catchError` from `next/error` doesn't interfere.
- **Open redirect**: `redirect(searchParams.get('next'))` or a callback URL from input — `redirect` accepts absolute URLs → users land on attacker sites. Fix: resolve with `new URL(value, origin)` and require the same origin.
- **redirect() in event handlers**: it works during render, in Server Actions and Route Handlers, not in client `onClick` code. Fix: `useRouter().push` from `next/navigation` (not `next/router`) in the App Router.
- **useSearchParams bailout**: on a prerendered route everything up to the nearest `<Suspense>` renders only in the browser → a boundary high in the tree ships an empty shell. Fix: wrap just the reader, or use the page's `searchParams`.
