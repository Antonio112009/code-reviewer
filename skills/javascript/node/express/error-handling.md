---
name: Error-handling middleware
description: Express error flow in every version — four-argument handler arity and position, errors thrown in callbacks, responses already sent, hanging handlers, non-Error next() values and upstream err.status reuse.
priority: 64
tags: [CWE-248, CWE-209, CWE-755]
activation:
  content:
    - "\\(\\s*(?:err|error|e)\\b[^()\\n]{0,120}\\bres\\b[^()\\n]{0,60}\\bnext\\b"
    - "\\bnext\\s*\\(\\s*(?:(?:err|error|e|ex)\\b|['\"`])"
    - "\\bres\\.headersSent\\b"
    - "\\.catch\\(\\s*next\\s*\\)"
    - "\\bstatus(?:Code)?\\s*\\(\\s*(?:err|error|e)\\.(?:status|statusCode)\\b"
sources:
  - https://expressjs.com/en/guide/error-handling.html
  - https://expressjs.com/en/5x/api/response/
---
- **Arity decides**: only functions with exactly four parameters (`fn.length === 4`) are error handlers — `(err, req, res)`, a default `next = noop` or rest args silently turn it into a normal middleware.
- **Registered too early**: error middleware must follow all routes and routers; routers mounted after it fall through to the default handler.
- **Callback throws**: `throw` inside callbacks, timers or stream/event handlers escapes Express in every version → process crash. Fix: `next(err)` from the callback, or promise APIs.
- **Headers already sent**: writing an error response after streaming began throws `ERR_HTTP_HEADERS_SENT`. Fix: `if (res.headersSent) return next(err)`.
- **Hanging handler**: a handler that only logs — no response, no `next(err)` — leaves the request open until the socket times out.
- **Non-Error next values**: only `'route'`/`'router'` are special; `next('Unauthorized')` or `next({ msg })` becomes a 500 error. Fix: pass `Error` objects with a `status`.
- **Stack traces**: the default handler sends `err.stack` unless `NODE_ENV=production`. Fix: set it and add a final handler with generic 5xx bodies.
- **Upstream status reuse**: `res.status(err.status || 500)` — and the default handler — forward `status`/`statusCode` of SDK or HTTP-client errors, so an upstream 401/404 becomes yours. Fix: map only your own error types.
