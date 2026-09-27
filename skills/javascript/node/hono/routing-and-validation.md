---
name: Routing, middleware and validators
description: Hono ordering and validation traps — middleware registered after handlers, app.route() copying sub-app routes at call time, next() not awaited, validators passing empty bodies, handlers re-reading unvalidated input, and Workers env/waitUntil misuse.
priority: 64
tags: [CWE-862, CWE-20]
activation:
  content:
    - "\\b(?:app|api|router|\\w+App)\\.(?:use|route|basePath|onError|notFound|all|on)\\s*\\("
    - "\\b(?:zValidator|validator|sValidator|vValidator|tbValidator|arktypeValidator)\\s*\\("
    - "\\bc\\.req\\.(?:json|parseBody|query|queries|param|header|valid|formData|text)\\s*\\("
    - "\\bawait\\s+next\\s*\\(|\\breturn\\s+next\\s*\\(|\\bnext\\s*\\(\\s*\\)"
    - "\\bc\\.(?:executionCtx|env)\\b|\\bwaitUntil\\s*\\("
sources:
  - https://hono.dev/docs/api/routing
  - https://hono.dev/docs/guides/middleware
  - https://hono.dev/docs/guides/validation
---
- **Registration order**: handlers and middleware run in registration order — `app.use('*', auth)` added after `app.get('/admin', …)` never runs for that route, and an early wildcard handler shadows later routes. Fix: middleware first, fallbacks last.
- **app.route copies**: `app.route('/api', api)` mounts the routes `api` has at call time — routes or middleware added to `api` later (import order) are missing → 404s or unauthenticated routes. Fix: finish sub-apps before mounting.
- **Missing await next()**: middleware must `await next()` or return a Response — calling `next()` without awaiting lets post-processing (headers, timing, error mapping) run before the handler finishes, or fails with "Context is not finalized".
- **Empty validated body**: `validator('json'|'form')`/`zValidator` validate `{}` when the Content-Type doesn't match → schemas whose fields are all optional pass. Fix: require the fields that scope the action; strict schemas.
- **Re-reading raw input**: handlers calling `await c.req.json()`/`c.req.query()` instead of `c.req.valid('json')` bypass the validator entirely. Fix: always read validated data via `c.req.valid()`.
- **Target specifics**: header validation needs lowercase keys (`'idempotency-key'`); query values are strings or arrays (`c.req.queries()`), so numeric and boolean schemas need coercion.
- **Workers context**: on Cloudflare Workers `process.env` is empty (use `c.env`), promises not passed to `c.executionCtx.waitUntil()` are cancelled after the response, and module-level state is shared by all requests in an isolate.
