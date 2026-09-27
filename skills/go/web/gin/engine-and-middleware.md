---
name: Gin engine, middleware order and client IP
description: Middleware registered after routes or groups, post-Next authorization, trusted proxies and spoofable ClientIP (v1.12 Unix-socket change), missing Recovery and upload limits.
priority: 66
tags: [CWE-284, CWE-348, CWE-400]
activation:
  content:
    - '\.Use\('
    - '\.Group\('
    - '\bgin\.(?:New|Default|Recovery\w{0,10}|SetMode|Platform\w{1,20})\b'
    - '\b(?:SetTrustedProxies|TrustedPlatform|RemoteIPHeaders|ForwardedByClientIP|MaxMultipartMemory|SaveUploadedFile|ContextWithFallback)\b'
    - '\bClientIP\(\)'
sources:
  - https://gin-gonic.com/en/docs/server-config/trusted-proxies/
  - https://github.com/gin-gonic/gin/blob/master/routergroup.go
  - https://github.com/gin-gonic/gin/releases/tag/v1.12.0
---
- **Use after routes**: Gin copies the current middleware into each route (and group) when it is registered → `r.Use(auth)` or `group.Use(auth)` placed after `r.GET(…)`/`r.Group(…)` never applies to them → unauthenticated endpoints. Fix: register middleware first.
- **Authorisation after Next**: checks placed after `c.Next()` run once the handler already executed; `c.Abort()` there only stops later handlers. Fix: authorise before `c.Next()` and `return` after aborting.
- **Trusted proxies**: Gin trusts all proxies by default, so `c.ClientIP()` returns client-supplied `X-Forwarded-For`/`X-Real-IP` → spoofed IPs defeat rate limits, allowlists and audit logs; since v1.12 XFF is always trusted over Unix sockets. Fix: `SetTrustedProxies([...])` or `nil`, or `TrustedPlatform`.
- **No Recovery**: `gin.New()` without `gin.Recovery()` → a panicking handler drops the connection without a 500 or request context in logs; panics in goroutines still crash. Fix: `gin.Recovery()`/`CustomRecovery`.
- **Uploads**: `MaxMultipartMemory` (32 MiB) only limits memory — larger uploads spill to disk without limit; `c.SaveUploadedFile(f, dir+f.Filename)` trusts client names. Fix: `http.MaxBytesReader` on `c.Request.Body`, generated file names.
