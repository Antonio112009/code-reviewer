---
name: Rate limiting
description: ASP.NET Core rate limiter defects — 503 default rejections, partition keys that collapse behind proxies or grow unbounded, middleware order and missing registrations, long queues and per-instance limits in scaled-out apps.
priority: 64
tags: [CWE-770, CWE-307]
activation:
  content:
    - '\b(?:AddRateLimiter|UseRateLimiter|RequireRateLimiting)\(|\[(?:EnableRateLimiting|DisableRateLimiting)\b'
    - '\bRateLimitPartition\b|\bPartitionedRateLimiter\b|\bRejectionStatusCode\b|\bQueueLimit\b|\bOnRejected\b'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit
  - https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/8/addratelimiter-requirement
  - https://github.com/dotnet/aspnetcore/blob/main/src/Middleware/RateLimiting/src/RateLimiterOptions.cs
---
- **503 by default**: rejected requests get `503 Service Unavailable` unless `RejectionStatusCode = 429` → clients and load balancers treat throttling as an outage and retry harder; no `Retry-After`. Fix: 429 plus `OnRejected` setting `Retry-After`.
- **Partition keys**: `RemoteIpAddress` behind a proxy without forwarded headers puts everyone in one bucket; unvalidated client-supplied keys (headers, API keys, user names) create unbounded partitions and allow bypass by rotation. Fix: authenticated identity or real client IP, plus a global limiter.
- **Order and registration**: `UseRateLimiter()` before `UseRouting()` ignores endpoint policies (`RequireRateLimiting`, `[EnableRateLimiting]`); .NET 8+ throws without `AddRateLimiter()`; group policies don't cover endpoints mapped elsewhere; `[DisableRateLimiting]` on login or OTP endpoints. Fix: correct order and coverage.
- **Queues**: large `QueueLimit` values hold requests (and connections) waiting instead of rejecting fast → latency spikes and timeouts. Fix: small queues or 0.
- **Per instance**: built-in limiters live in process memory → the effective limit multiplies with replicas. Fix: gateway or distributed (e.g. Redis) limits for quotas.
