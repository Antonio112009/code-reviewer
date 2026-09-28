---
name: Built-in security middleware
description: Hono security helpers misconfigured — JWT without a pinned alg, permissive CORS, CSRF limited to form content types and request-URL origins, no default body size limit, serveStatic path bypasses, spoofable client IPs and un-awaited signed cookies.
priority: 66
tags: [CWE-347, CWE-352, CWE-400, CWE-348]
activation:
  content:
    - "(?:from|require\\()\\s*['\"]hono/(?:jwt|jwk|cors|csrf|secure-headers|body-limit|basic-auth|bearer-auth|ip-restriction|cookie|conninfo)['\"]"
    - "\\b(?:jwt|jwk|cors|csrf|secureHeaders|bodyLimit|basicAuth|bearerAuth|ipRestriction)\\s*\\("
    - "\\bserveStatic\\s*\\(|\\bgetConnInfo\\s*\\(|\\bparseBody\\s*\\("
    - "\\b(?:getCookie|getSignedCookie|setSignedCookie|setCookie)\\s*\\("
  examples:
    - 'import { cors } from "hono/cors"'
    - 'app.use("*", cors({ origin: "*" }))'
    - 'app.use("/static/*", serveStatic({ root: "./public" }))'
    - 'const token = await getSignedCookie(c, secret, "session")'
sources:
  - https://hono.dev/docs/middleware/builtin/jwt
  - https://github.com/honojs/hono/security/advisories/GHSA-f67f-6cw9-8mq4
  - https://hono.dev/docs/middleware/builtin/csrf
  - https://github.com/honojs/hono/security/advisories
---
- **JWT algorithm**: before 4.11.4 `jwt()`/`jwk()` defaulted to HS256 or took `alg` from the token header — algorithm confusion with public keys; newer versions require `alg`. Fix: upgrade, pin `alg`, check `iss`/`aud`.
- **CORS**: `cors()` defaults to `origin: '*'`; an `origin` callback echoing any request origin plus `credentials: true` lets every site read authenticated responses. Fix: explicit allowlist.
- **CSRF scope**: `csrf()` checks `Origin`/`Sec-Fetch-Site` only for unsafe methods with form content types, and by default trusts only the request URL's origin — behind a TLS proxy that mismatches, tempting `origin: () => true`.
- **No body limit**: Hono sets no request-size limit (Node adapter unbounded, Bun 128 MiB), so `c.req.json()`/`parseBody()` read attacker-sized bodies. Fix: `bodyLimit()` on write routes.
- **serveStatic bypasses**: path-scoped auth (`app.use('/admin/*', auth)`) in front of `serveStatic` could be skipped with `//admin/…` (CVE-2026-39407) or `%5C` on Windows. Fix: upgrade; keep private files out of static roots.
- **Client IP**: `x-forwarded-for` is client-controlled unless the proxy overwrites it, and `getConnInfo()` returns the proxy's address behind a load balancer → `ipRestriction` judges the wrong client.
- **Signed cookies**: `getSignedCookie()` is async — un-awaited, its Promise is truthy — and returns `false` (not `undefined`) for tampered values. Fix: `await` and compare strictly.
