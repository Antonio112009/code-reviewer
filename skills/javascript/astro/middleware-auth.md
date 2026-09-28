---
name: Middleware, auth and sessions
description: Astro middleware and session defects — prerendered pages assumed protected, broken onRequest return contract, bypassable path checks, disabled or bypassed origin checks, forwarded-host trust and session fixation.
category: security
priority: 70
tags: [CWE-285, CWE-352, CWE-384]
activation:
  files: ["**/src/middleware{,/index}.{ts,js}", "**/src/middleware/**/*.{ts,js}", "**/src/fetch.{ts,js}"]
  content:
    - "\\b(?:onRequest|defineMiddleware)\\b"
    - "\\b(?:checkOrigin|allowedDomains)\\b"
    - "\\b(?:Astro|context)\\.session\\b"
    - "\\bsession\\.(?:regenerate|destroy)\\s*\\("
    - "from ['\"]astro/hono['\"]"
  examples:
    - 'export const onRequest = defineMiddleware(async (context, next) => next());'
    - 'security: { checkOrigin: false },'
    - 'await context.session.regenerate();'
    - 'import { pages } from ''astro/hono'';'
sources:
  - https://docs.astro.build/en/guides/middleware/
  - https://docs.astro.build/en/guides/sessions/
  - https://docs.astro.build/en/reference/configuration-reference/
  - https://github.com/withastro/astro/security/advisories/GHSA-8mv7-9c27-98vc
---
- **Prerendered pages "protected" by middleware**: middleware runs only at build time for prerendered routes → the page is a public static file whatever the auth check says. Fix: `prerender = false` for protected routes.
- **Return contract**: `onRequest` paths that neither `return next()` nor return a `Response` → broken responses. Fix: return on every path.
- **Bypassable path checks**: `url.pathname.startsWith('/admin')` without normalizing case, trailing slashes, encoding or `base` → bypasses, or over-matching `/administrator`. Fix: match exact route segments; deny by default.
- **Origin check off or bypassed**: `security.checkOrigin: false`, or Astro 7 `astro/hono` pipelines mounting `actions()`/`pages()` before `middleware()` (fixed in 7.0.5) → cross-site form posts succeed. Fix: keep `checkOrigin`; mount `middleware()` first.
- **Forwarded-host trust**: building redirects or links from a manually read `X-Forwarded-Host` → spoofable; Astro ignores it unless `security.allowedDomains` (5.14.2+) lists the host. Fix: configure `allowedDomains`; use `Astro.url`.
- **Session fixation**: logging in without `Astro.session.regenerate()`, or not calling `destroy()` on logout → reused session ids. Fix: regenerate on every privilege change.
