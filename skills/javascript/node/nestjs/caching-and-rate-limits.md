---
name: Response caching and throttling
description: NestJS CacheInterceptor serving one user's GET responses to others, millisecond TTLs and never-expiring Keyv entries, JSON-revived cache hits, and @nestjs/throttler millisecond windows, spoofable trackers and per-process storage.
priority: 64
tags: [CWE-524, CWE-307, CWE-348]
activation:
  content:
    - "\\bCacheInterceptor\\b|\\bCacheModule\\b|@CacheKey\\s*\\(|@CacheTTL\\s*\\(|\\bCACHE_MANAGER\\b|\\bcacheManager\\.(?:get|set|del|mget|mset|wrap|clear)\\b"
    - "\\bThrottlerModule\\b|\\bThrottlerGuard\\b|@(?:Throttle|SkipThrottle)\\s*\\(|\\bgetTracker\\s*\\("
sources:
  - https://docs.nestjs.com/techniques/caching
  - https://docs.nestjs.com/security/rate-limiting
  - https://github.com/nestjs/nest/pull/10380
---
- **URL-keyed cache**: `CacheInterceptor` (global or per controller) keys GET responses by URL only → `/me`, `/orders` and tenant-scoped lists are served to other users. Fix: skip authenticated routes or override `trackBy()` with user/tenant.
- **TTL units**: cache-manager v5+ (`@nestjs/cache-manager`) takes milliseconds — `ttl: 60` or `@CacheTTL(300)` expire almost immediately; values ported from v4 seconds thrash the cache. Fix: `ttl: 60_000`.
- **Never expires**: with the Keyv-based stores (Nest 11), no `ttl` means entries never expire → stale data and an ever-growing in-memory store. Fix: a default `ttl`.
- **JSON round-trip**: Keyv serialises values to JSON — cache hits return `Date`s as strings and plain objects instead of class instances → `.getTime()` crashes and `instanceof`/`@Exclude` rules stop applying on hits.
- **Throttler TTL**: `@nestjs/throttler` v5+ also uses milliseconds — `ttl: 60` is a 60 ms window, i.e. no real limit. Fix: `seconds(60)` or `60_000`.
- **Spoofable tracker**: `getTracker` returning `req.ips[0]` or a raw `x-forwarded-for` uses the client-supplied leftmost address, letting attackers rotate keys; without `trust proxy` everyone shares the load balancer IP.
- **Per-process storage**: default throttler and cache storage live in memory — limits multiply and caches diverge across replicas. Fix: Redis-backed storage.
