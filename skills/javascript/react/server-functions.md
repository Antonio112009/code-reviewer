---
name: Server Functions ('use server')
description: React Server Function defects in any RSC framework — publicly callable functions without authorization, client-controlled arguments, leaky return values, non-serializable arguments and Server Functions used for reads.
priority: 72
tags: [CWE-862, CWE-639, OWASP-A01]
activation:
  content: ["['\"]use server['\"]"]
  examples:
    - "'use server';"
sources:
  - https://react.dev/reference/rsc/use-server
  - https://react.dev/reference/rsc/server-functions
  - https://nextjs.org/docs/app/guides/server-actions
---
- **Unprotected endpoint**: every exported function of a `'use server'` file and every inline server function accepts direct POSTs with arbitrary arguments; hidden buttons or page-level auth don't protect it → unauthorized writes, IDOR. Fix: authenticate and check ownership inside each.
- **Trusted arguments**: IDs, whole objects (`update(item)`), `.bind()` arguments, hidden inputs and `FormData` entries (`string | File | null`) are client-controlled → tampered owners, roles or prices. Fix: accept IDs, schema-validate, re-read records server-side.
- **Leaky return values**: returning ORM entities, full user records or raw error objects → serialized to the client. Fix: return only what the UI needs.
- **Non-serializable arguments**: event objects, class instances, functions or JSX passed to a Server Function → serialization errors at runtime. Fix: plain values or `FormData`.
- **Server Functions for reads**: calling them to load data from effects or render → sequential POSTs, no caching, request waterfalls. Fix: fetch in Server Components or loaders.
