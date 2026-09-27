---
name: Proxies, redirects, CORS and sessions
description: Koa security settings — app.proxy with unlimited X-Forwarded-For hops, open redirects via ctx.redirect/ctx.back, @koa/cors origin reflection before v5, cookie-based koa-session stores, unsigned cookies and body-parser or static-file limits.
priority: 64
tags: [CWE-348, CWE-601, CWE-942, CWE-565]
activation:
  content:
    - "\\bapp\\.(?:proxy|maxIpsCount|proxyIpHeader|keys)\\b|\\bproxy\\s*:\\s*true\\b"
    - "\\bctx\\.(?:ip|ips|protocol|host|hostname|redirect|back|cookies)\\b"
    - "@koa/(?:cors|bodyparser|multer)|\\bkoa-(?:session|body|bodyparser|static|send|mount)\\b"
sources:
  - https://github.com/koajs/koa/blob/master/docs/api/index.md
  - https://github.com/koajs/koa/security/advisories/GHSA-g8mr-fgfg-5qpc
  - https://github.com/advisories/GHSA-x2rg-q646-7m2v
  - https://github.com/koajs/session
---
- **Proxy IPs**: `app.proxy = true` with `maxIpsCount` 0 (default, unlimited) makes `ctx.ip` the leftmost, client-supplied X-Forwarded-For entry; `ctx.protocol`/`ctx.host` trust headers too. Fix: `maxIpsCount` = real hop count; `proxy` only behind a proxy.
- **Redirects**: `ctx.redirect(ctx.query.next)` is an open redirect; `ctx.redirect('back')`/`ctx.back()` follow the Referer and had `//host` bypasses until 2.16.3/3.0.3, and redirect bodies were XSS-able before 2.16.1. Fix: allowlist targets; upgrade.
- **@koa/cors < 5**: without an `origin` option it reflected the request Origin (CVE-2023-49803) — with `credentials: true` any site reads authenticated responses. Fix: ≥5 and an origin allowlist.
- **Cookie sessions**: koa-session's default store keeps the whole session in the cookie, signed but unencrypted — clients read it and it can't be revoked server-side. Fix: external store for auth data; no secrets in `ctx.session`.
- **Unsigned cookies**: `ctx.cookies.get(name)` without `{ signed: true }` returns client-editable values, and signing needs `app.keys`. Fix: `signed: true` on set and get.
- **Body and static limits**: koa-body enables `multipart` only on request and then needs `formidable.maxFileSize`/`maxFiles`; `originalFilename` must not become a path; `koa-static`/`koa-send` on a project root expose sources. Fix: explicit limits, dedicated `root`.
