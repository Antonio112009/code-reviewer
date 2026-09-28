---
name: Response, output and memory caching
description: Caching defects — per-user responses cached publicly or by custom output-cache policies, incomplete cache keys, IMemoryCache without size limits or with user-controlled keys, non-atomic GetOrCreate stampedes and mutation of shared cached objects.
priority: 64
tags: [CWE-524, CWE-400, A01:2025]
activation:
  content:
    - '\[ResponseCache\b|\bResponseCacheLocation\b|\bUseResponseCaching\(|Cache-Control'
    - '\[OutputCache\b|\b(?:AddOutputCache|UseOutputCache|CacheOutput)\(|\bIOutputCachePolicy\b|\bSetVaryBy\w+\('
    - '\bIMemoryCache\b|\bMemoryCacheOptions\b|\bGetOrCreate(?:Async)?\b|\bSizeLimit\b|\bHybridCache\b|\bIDistributedCache\b'
  examples:
    - '[ResponseCache(Duration = 60, Location = ResponseCacheLocation.Any)]'
    - '[OutputCache(PolicyName = "Expire60")]'
    - 'var value = await _cache.GetOrCreateAsync(key, entry => LoadAsync(entry));'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/performance/caching/output
  - https://learn.microsoft.com/en-us/aspnet/core/performance/caching/memory
  - https://learn.microsoft.com/en-us/aspnet/core/performance/caching/hybrid
  - https://learn.microsoft.com/en-us/aspnet/core/performance/caching/response
---
- **Per-user data cached publicly**: `[ResponseCache(Location = Any)]`/`Cache-Control: public` on authenticated or personalized responses → CDNs and proxies serve one user's data to others. Output caching skips authenticated requests only in its default policy — custom policies can re-enable storage. Fix: `private`/`no-store`.
- **Incomplete keys**: cached responses that depend on claims, tenant, `Accept-Language` or other headers not in the key (`SetVaryByHeader`, `VaryByValue`) → wrong content served. Fix: vary on every input.
- **Unbounded IMemoryCache**: no `SizeLimit` (the cache doesn't trim under memory pressure), user-controlled keys, no expirations → memory exhaustion; with `SizeLimit` every entry must set `Size` or inserts throw. Fix: dedicated sized cache, expirations, bounded keys.
- **Stampedes**: `IMemoryCache.GetOrCreate(Async)` runs the factory concurrently for the same key → thundering herd on expiry. Fix: `HybridCache` (.NET 9+) or per-key locking.
- **Shared mutable instances**: `IMemoryCache` hands every caller the same object → mutating a cached list or entity corrupts it for all requests and races across threads. Fix: cache immutable data or copies.
