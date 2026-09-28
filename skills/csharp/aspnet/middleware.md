---
name: Middleware pipeline
description: ASP.NET Core pipeline defects — middleware order (routing, CORS, authentication, authorization, rate limiting, forwarded headers), singleton middleware capturing scoped services, writing after the response started, missing next(), body re-reads and null ContentLength checks.
priority: 68
tags: [CWE-696, A02:2025]
activation:
  content:
    - '\bapp\.(?:Use|UseWhen|Map|MapWhen|Run)\w*\('
    - '\bIApplicationBuilder\b|\bIMiddleware\b|\bRequestDelegate\b|\bInvokeAsync\(\s*HttpContext\b'
    - '\bEnableBuffering\(|\bResponse\.HasStarted\b|\bOnStarting\(|\bRequest\.ContentLength\b'
  examples:
    - 'app.UseRouting();'
    - 'public Task InvokeAsync(HttpContext context)'
    - 'Request.Body.EnableBuffering();'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/write
---
- **Order**: `UseAuthorization()` before `UseAuthentication()`, middleware reading `context.User` before authentication, or reading endpoint metadata before `UseRouting()` → anonymous user/null endpoint, checks skipped. Fix: forwarded headers → exception handler → HTTPS → static files → routing → CORS → authn → authz → custom → endpoints.
- **Placement-sensitive middleware**: `UseCors` must sit after `UseRouting` and before `UseAuthorization`/response or output caching; `UseRateLimiter` after `UseRouting` for endpoint policies; `UseForwardedHeaders` first → otherwise preflights fail and policies never apply.
- **Singleton middleware**: conventional middleware classes (`InvokeAsync(HttpContext)`) are created once — scoped services (`DbContext`, current-user) injected via the constructor are shared across requests. Fix: add them as `InvokeAsync` parameters or implement `IMiddleware`.
- **After the response started**: setting headers/status, or calling `next()` after writing the body → "Headers are read-only" or corrupted responses. Fix: check `Response.HasStarted`, use `Response.OnStarting`.
- **Short-circuiting**: forgetting `await next(context)` (or not awaiting it) ends or races the pipeline; anything registered after `app.Run(...)` never executes.
- **Body re-reads**: reading `Request.Body` without `EnableBuffering()` and rewinding (`Position = 0`) → model binding sees an empty body. Fix: buffer with limits, `await` reads.
- **Null ContentLength**: `if (Request.ContentLength > limit)` is false when the header is absent (chunked uploads) → size checks bypassed. Fix: enforce via server limits or count bytes while reading.
