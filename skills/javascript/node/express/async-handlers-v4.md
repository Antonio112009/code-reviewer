---
name: Async handlers in Express 4
description: Express 4 ignores promises returned by handlers — rejections from async routes, middleware and param callbacks never reach next(), hanging requests or crashing Node; wrappers only protect what they wrap.
priority: 68
tags: [CWE-248, CWE-755]
activation:
  versions: { framework.express: "<5" }
  content:
    - "\\basync\\s*(?:function\\b[^(\\n]{0,40})?\\(\\s*(?:req|request|_req)\\b"
    - "\\basync\\s*\\(\\s*(?:err|error)\\s*,\\s*req\\b"
    - "\\.then\\s*\\([^\\n]{0,120}\\bres\\.(?:json|send|status|render|redirect)\\b"
    - "\\b(?:express-async-errors|express-async-handler|asyncHandler|catchAsync|wrapAsync)\\b"
    - "\\.param\\s*\\(\\s*['\"]\\w+['\"]\\s*,\\s*async\\b"
  examples:
    - 'router.get(''/users'', async (req, res) => {'
    - 'app.use(async (err, req, res, next) => { await logError(err); next(err); });'
    - 'fetchUser(id).then((user) => res.json(user)).catch(next);'
    - 'const asyncHandler = require(''express-async-handler'');'
    - 'router.param(''id'', async (req, res, next, id) => {'
sources:
  - https://expressjs.com/en/guide/error-handling.html
  - https://expressjs.com/en/guide/migrating-5.html
---
- **Rejected async handler**: Express 4 ignores the promise returned by `async (req, res) => {…}` — a rejection never reaches error middleware, the request hangs and Node ≥15 exits on the unhandled rejection. Fix: `try/catch` + `next(err)` or a wrapper.
- **Async middleware**: `async` auth or validation middleware that throws before calling `next()` stops the chain silently (hang); work awaited after `next()` fails after the response was produced. Fix: wrap it and call `next()` last.
- **Unreturned chains**: `.then((r) => res.json(r))` without `.catch(next)`, or fire-and-forget promises inside handlers, produce unhandled rejections the error middleware never sees. Fix: `await` inside `try`, or `.catch(next)`.
- **Partial wrapping**: `asyncHandler(fn)`/`catchAsync` protect only wrapped functions — one unwrapped async route, `router.param` callback or async error handler brings the hang back. Fix: wrap uniformly (or `express-async-errors`) until moving to Express 5.
