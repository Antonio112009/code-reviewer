---
name: Actions and forms (Remix / React Router)
description: Action defects in Remix / React Router framework mode — per-intent authorization gaps, untyped formData, open redirects via redirectTo, CSRF gaps on resource routes and older versions, GET-default submissions, revalidation after failed actions and mutations in loaders.
priority: 70
tags: [CWE-352, CWE-601, CWE-862]
activation:
  content:
    - "\\bexport\\s+(?:async\\s+)?function\\s+(?:action|clientAction)\\b"
    - "\\bexport\\s+const\\s+action\\s*="
    - "\\buse(?:Fetcher|Submit|ActionData)\\b"
    - "<(?:Form|fetcher\\.Form)\\b"
    - "\\bredirectTo\\b"
sources:
  - https://reactrouter.com/start/framework/actions
  - https://api.reactrouter.com/v7/interfaces/react-router.SubmitOptions.html
  - https://github.com/remix-run/react-router/security/advisories/GHSA-2w69-qvjg-hvjx
  - https://reactrouter.com/changelog
---
- **Unauthorized intents**: one action switching on `formData.get('intent')` with authorization in some branches only → any user can post any intent. Fix: check session and ownership in every branch.
- **Untyped formData**: `formData.get()` returns `string | File | null`; `as string` casts and unchecked `Number()` accept files, empty values and NaN → corrupt writes. Fix: schema validation.
- **Open redirect**: `redirect(formData.get('redirectTo'))` or a `?redirectTo=` value → `//evil.com`, `/\evil.com` or `javascript:` targets (several React Router advisories) → phishing or XSS. Fix: resolve with `new URL(value, origin)` and require the same origin.
- **CSRF gaps**: the origin check on action requests exists only since 7.12 (Remix 2.17.3), covers PUT/PATCH/DELETE since 7.15.1, and never covers resource-route actions; broad `allowedActionOrigins` weaken it. Fix: SameSite cookies, tokens on resource routes.
- **GET by default**: `<Form>`, `useSubmit()` and `fetcher.submit()` default to `method: "GET"` → the submission runs the loader, not the action. Fix: `method="post"`.
- **Failed actions skip revalidation**: under Single Fetch a 4xx/5xx action result doesn't revalidate loaders → stale UI when the action wrote partially. Fix: return success after partial writes, or revalidate explicitly.
- **Mutations in loaders**: logout or other state changes in a `loader` (GET) → CSRF and prefetch-triggered. Fix: do them in actions.
