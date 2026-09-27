---
name: Next.js authorization placement
description: Where App Router authorization breaks — checks only in layouts, request-time checks on statically prerendered routes, access decided from URL input, client-side redirects as protection, mutations on GET and no Data Access Layer.
priority: 70
tags: [CWE-285, CWE-862, CWE-639, OWASP-A01]
activation:
  content:
    - "\\b(?:auth|getSession|getServerSession|currentUser|verifySession|getCurrentUser)\\s*\\("
    - "\\bsession\\??\\.user\\b"
    - "\\bisAdmin\\b"
    - "['\"]server-only['\"]"
sources:
  - https://nextjs.org/docs/app/guides/authentication
  - https://nextjs.org/docs/app/guides/data-security
  - https://nextjs.org/docs/app/api-reference/file-conventions/layout
---
- **Layout-only checks**: auth in `layout.tsx` doesn't re-run on client navigations, and a layout that hides `children` doesn't stop nested pages or slots from rendering into the RSC payload → data served unchecked. Fix: verify in the data layer.
- **Static routes skip request-time checks**: on statically prerendered routes data is fetched at build, so per-request DAL checks never run for visitors and one rendered result is shared. Fix: make gated routes dynamic, or gate static content in the proxy.
- **Access from URL input**: `searchParams.isAdmin === 'true'`, role or tenant IDs from `params`, or hidden fields deciding access → trivially forged. Fix: derive identity and roles from the session.
- **Client-side protection**: `useEffect(() => { if (!user) router.push('/login') })` or conditional rendering in Client Components → the server-rendered data and RSC payload already reached the browser. Fix: check on the server before fetching.
- **Mutations on GET**: deletes, logout or other state changes in page renders, `GET` handlers or `<Link>` targets → triggered by prefetching and cross-site requests. Fix: POST via Server Actions or handlers.
- **No Data Access Layer**: DB queries and secrets spread across components → missed checks and leaked fields. Fix: a `server-only` DAL that authorizes and returns DTOs, with a `cache()`d session lookup.
