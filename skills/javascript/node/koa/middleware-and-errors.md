---
name: Middleware flow and error handling
description: Koa cascade defects — next() not awaited, error middleware mounted too late, err.expose leaking or hiding messages, bodies never set (silent 404) and Koa 3 removals such as ctx.redirect('back') and generator middleware.
priority: 64
tags: [CWE-209, CWE-755]
activation:
  content:
    - "\\bnext\\s*\\(\\s*\\)"
    - "\\bctx\\.(?:throw|assert|status|body|respond)\\b"
    - "\\bapp\\.on\\s*\\(\\s*['\"]error['\"]|\\bexpose\\s*[:=]"
    - "\\bctx\\.redirect\\s*\\(\\s*['\"]back['\"]|\\bkoa-convert\\b|\\bfunction\\s*\\*"
sources:
  - https://github.com/koajs/koa/blob/master/docs/api/index.md
  - https://github.com/koajs/koa/blob/master/docs/error-handling.md
  - https://github.com/koajs/koa/blob/master/docs/migration-v2-to-v3.md
---
- **Unawaited next()**: middleware calling `next()` without `await`/`return` resolves before downstream finishes → the response is sent early (404 or empty body), timing/header logic runs too soon and downstream errors escape its `try/catch`. Fix: `await next()`.
- **Error middleware position**: `try { await next() } catch` only covers middleware registered after it — mount it first; errors thrown in callbacks, timers or stream events never reach it. Fix: first middleware, promisified APIs.
- **expose semantics**: `ctx.throw(4xx, msg)` sets `expose: true`, so `msg` goes to the client — passing DB or upstream error text leaks it; custom handlers writing `err.message`/`stack` for 5xx leak internals. Fix: generic 5xx bodies, log via `app.on('error')`.
- **Silent 404**: `ctx.status` defaults to 404 — a branch that forgets `ctx.body`, or sets it after an un-awaited promise, answers 404 instead of data or an error. Fix: set status explicitly; await before assigning.
- **Koa 3 removals**: `ctx.redirect('back')` was removed (use `ctx.back(fallback)`) — old calls now redirect to the literal path `back`; generator middleware (`koa-convert`) no longer works; `ctx.query` parsing moved to `URLSearchParams`.
