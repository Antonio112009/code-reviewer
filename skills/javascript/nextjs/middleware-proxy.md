---
name: Proxy / middleware
description: Next.js proxy.ts / middleware.ts defects — authorization only at the proxy (known bypasses), matcher gaps, spoofable identity headers, request headers leaked to browsers, user-controlled rewrites and Next.js 16 proxy rules.
priority: 70
tags: [CWE-285, CWE-290, CWE-601, CWE-918]
activation:
  files: ["**/{middleware,proxy}.{js,ts}"]
  content:
    - "\\bNextResponse\\.(?:next|rewrite|redirect)\\s*\\("
    - "\\bmatcher\\s*:"
    - "\\bexport\\s+(?:default\\s+)?(?:async\\s+)?function\\s+(?:middleware|proxy)\\b"
sources:
  - https://nextjs.org/docs/app/api-reference/file-conventions/proxy
  - https://github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw
  - https://nextjs.org/blog/july-2026-security-release
  - https://nextjs.org/docs/app/guides/upgrading/version-16
---
- **Auth only at the proxy**: pages, handlers and actions trusting the proxy's check → bypassed via `x-middleware-subrequest` (CVE-2025-29927, before 15.2.3/14.2.25/13.5.9), Turbopack with one i18n locale (CVE-2026-64642) or matcher gaps. Fix: re-check in the data layer.
- **Matcher gaps**: non-constant `matcher` values (variables are ignored), regex typos, or exclusions like `api` → Server Actions (POSTs to the page route) and handlers on excluded paths skip the proxy. Fix: literal, tested matchers.
- **No matcher**: the proxy also runs for `_next/static`, `_next/image` and `public/` files → auth redirects break CSS/JS/images and every asset pays the latency. Fix: exclude static paths.
- **Spoofable identity headers**: the proxy sets `x-user-id`/`x-role` for downstream code, but unmatched routes (or branches) pass a client-sent copy through → impersonation. Fix: delete incoming copies, or re-read the session.
- **Leaking request headers**: `NextResponse.next({ headers })` sends them to the browser; only `NextResponse.next({ request: { headers } })` forwards them upstream.
- **User-controlled rewrites**: `NextResponse.rewrite(new URL(param, request.url))` or redirects built from query values → open redirects or proxying to attacker/internal hosts. Fix: allowlist paths and hosts.
- **Next.js 16 rules**: `middleware.ts` is deprecated for `proxy.ts`, which runs only on Node.js (a `runtime` export throws) and must not rely on module globals as shared state.
