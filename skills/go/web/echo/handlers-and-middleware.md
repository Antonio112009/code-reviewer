---
name: Echo handlers, binding, middleware and errors (v4/v5)
description: Echo handlers not returning after writes, Bind letting body fields override path parameters, RealIP trusting headers, group middleware order, error-handler changes in v5, CORS credentials and pooled contexts.
priority: 64
tags: [CWE-639, CWE-348, CWE-209]
activation:
  content:
    - '\bc\.(?:Bind|JSON|String|NoContent|Redirect|RealIP|Param|QueryParam|FormValue)\('
    - '\be\.(?:Use|Pre|Group|IPExtractor|HTTPErrorHandler|Debug)\b'
    - '\bmiddleware\.(?:CORS\w{0,10}|Timeout\w{0,10}|BodyLimit|Recover\w{0,10})\b'
    - '\becho\.(?:Bind\w{2,15}|Extract\w{2,25}|NewHTTPError|StatusCode|HTTPError|Err\w{2,20})\b'
sources:
  - https://echo.labstack.com/guide/binding/
  - https://echo.labstack.com/guide/ip-address/
  - https://github.com/labstack/echo/blob/master/API_CHANGES_V5.md
  - https://echo.labstack.com/middleware/cors/
---
- **Return the response**: `c.JSON(…)` without `return`, or returning an error after the response was committed → the handler keeps running and the error handler can only log. Fix: `return c.JSON(…)`.
- **Bind overrides path ids**: `c.Bind` fills path params, then query (GET/DELETE/HEAD), then the body, each overwriting the last → a body `"id"` replaces the checked `:id` (IDOR, mass assignment). Fix: bind body and path separately into DTOs.
- **RealIP**: without `e.IPExtractor`, `c.RealIP()` trusts the first `X-Forwarded-For`/`X-Real-IP` → spoofed IPs in rate limits and audit logs. Fix: `echo.ExtractIPDirect()` or `ExtractIPFromXFFHeader(trust options)`.
- **Group middleware order**: `g.Use(mw)` covers only routes added to the group afterwards; routing middleware (trailing slash, method override) must be `e.Pre`. → unprotected routes.
- **Errors (v5)**: `echo.ErrNotFound`/`ErrMethodNotAllowed` are no longer `*echo.HTTPError` → custom handlers asserting `*HTTPError` turn 404/405 into 500; `e.Debug = true` or echoing `err.Error()` leaks internals. Fix: `echo.StatusCode(err)`.
- **CORS with credentials**: v5 panics on `"*"` + `AllowCredentials`, but an `UnsafeAllowOriginFunc` (v4: `UnsafeWildcardOriginWithAllowCredentials`) accepting any origin allows credentialed cross-site reads.
- **Pooled context**: the context is reused for the next request → never keep it in goroutines after the handler returns.
