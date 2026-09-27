---
name: Server/Client component boundary
description: React Server Component boundary defects — server data serialized into Client Component props, server-only modules in the client graph, Server Components imported by client modules, non-serializable props, oversized client boundaries and cache() scope.
priority: 68
tags: [CWE-200]
activation:
  content:
    - "^\\s*['\"]use client['\"]"
    - "['\"](?:server|client)-only['\"]"
    - "\\bexperimental_taint\\w*"
    - "\\bexport\\s+default\\s+async\\s+function\\b"
sources:
  - https://react.dev/reference/rsc/use-client
  - https://react.dev/reference/rsc/server-components
  - https://nextjs.org/docs/app/guides/data-security
  - https://react.dev/reference/react/cache
---
- **Server data in client props**: DB rows, user objects or configs passed to a `'use client'` component are serialized whole into the RSC payload, unrendered fields included (hashes, tokens, emails). Fix: minimal DTOs; taint APIs only as a backstop.
- **Server code in the client graph**: a `'use client'` module or its imports use DB clients, `fs`, secrets or server-only env vars → shipped to the browser or a build failure. Fix: `import 'server-only'` in server modules.
- **Server Component imported by a client module**: importing it into a `'use client'` file makes it client code → it runs in the browser, `async` components break, server-only imports fail. Fix: pass it as `children` from a Server Component.
- **Non-serializable props**: functions (other than Server Functions), class instances, `Symbol()` values or null-prototype objects passed from Server to Client Components → runtime error. Fix: plain data; Server Functions for callbacks.
- **Oversized client boundary**: `'use client'` on layouts, pages or root providers makes every import client code → big bundles, server helpers dragged in. Fix: push the directive to leaves, pass server content as `children`.
- **React cache() scope**: `cache()` dedupes only within one server request and only in Server Components (client caching was removed in 19); a `cache()` created inside a component shares nothing. Fix: create it at module level.
