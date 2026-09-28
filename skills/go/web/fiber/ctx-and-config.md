---
name: Fiber context lifetime, recovery, errors and proxies (v2/v3)
description: Fiber zero-allocation values reused after the handler, pooled Ctx in goroutines, v2/v3 context accessors, no default panic recovery, default error handler leaking messages, proxy/IP trust, Prefork state and v3 session changes.
priority: 66
tags: [CWE-362, CWE-209, CWE-348]
activation:
  content:
    - '\bc\.(?:Params|Query|Get|Body|FormValue|Cookies|IP|IPs|Locals|UserContext|Context|RequestCtx|BodyParser|Bind)\('
    - '\b(?:Immutable|ProxyHeader|EnableTrustedProxyCheck|TrustedProxies|TrustProxy\w{0,6}|Prefork|EnablePrefork|ErrorHandler)\b'
    - '\b(?:recover|session|limiter)\.New\('
    - '\bfiber\.(?:New|Config|IsChild)\b'
  examples:
    - 'id := c.Params("id")'
    - 'app := fiber.New(fiber.Config{Immutable: true})'
    - 'app.Use(recover.New())'
sources:
  - https://docs.gofiber.io/#zero-allocation
  - https://docs.gofiber.io/guide/error-handling
  - https://docs.gofiber.io/whats_new
---
- **Reused buffers**: strings/bytes from `c.Params`, `c.Query`, `c.Get`, `c.Body`, `c.FormValue` or `c.Cookies` point into buffers reused after the handler → values kept in maps, caches or goroutines change under load. Fix: `utils.CopyString`/`strings.Clone`, or `Immutable: true`.
- **Pooled Ctx**: `*fiber.Ctx` (v2) / `fiber.Ctx` (v3) must not be used in goroutines or callbacks after the handler returns. Fix: copy values first.
- **Context accessors**: v2 `c.Context()` is the fasthttp ctx and `c.UserContext()` is `Background()` unless set; v3 `Ctx` itself is a `context.Context` and fasthttp moved to `c.RequestCtx()` → upgrades pass the wrong context.
- **No default recovery**: one unrecovered handler panic crashes the whole server. Fix: `recover.New()` first.
- **Default ErrorHandler**: sends `err.Error()` to clients for any non-`*fiber.Error` (500 with DB/internal text). Fix: custom `ErrorHandler`.
- **Proxy trust**: `ProxyHeader` without v2 `EnableTrustedProxyCheck`+`TrustedProxies` (v3 `TrustProxy`+`TrustProxyConfig`) → `c.IP()` returns spoofable headers, fooling limiters.
- **Prefork**: each child process has its own memory — in-memory limiter/session/cache storage and in-process cron jobs multiply per child. Fix: shared storage; jobs only when `!fiber.IsChild()`.
- **v3 sessions**: sessions are no longer released after `Save` → call `sess.Release()` or pooled objects leak.
