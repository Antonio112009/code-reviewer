---
name: Spring Cache abstraction
description: '@Cacheable/@CacheEvict defects — key collisions from the default key generator, unbounded no-TTL default caches, shared mutable cached objects, per-user data under global keys, stampedes, eviction timing with transactions and cached nulls.'
priority: 60
tags: [CWE-524, CWE-400]
activation:
  content:
    - '@(?:Cacheable|CacheEvict|CachePut|Caching|CacheConfig|EnableCaching)\b'
    - '\b(?:CacheManager|RedisCacheConfiguration|CaffeineCacheManager)\b'
    - '\bspring\.cache\.'
  examples:
    - '@Cacheable("users")'
    - 'CacheManager manager = new CaffeineCacheManager();'
    - 'spring.cache.type=caffeine'
sources:
  - https://docs.spring.io/spring-framework/reference/integration/cache/annotations.html
  - https://docs.spring.io/spring-boot/reference/io/caching.html
---
- **Key collisions**: the default key is just the method arguments (the method name is not included; no-arg methods share `SimpleKey.EMPTY`) → methods sharing a cache name return each other's values. Fix: separate caches or an explicit `key`.
- **Unbounded default cache**: with no provider, Boot uses a `ConcurrentHashMap` cache without TTL or size limit → memory growth and stale data forever. Fix: Caffeine or Redis with expiry and a maximum size.
- **Shared mutable results**: in-memory caches hand the same instance to every caller → one caller sorting a list or setting fields corrupts the cached value. Fix: cache immutable objects or copies.
- **Per-user data, global key**: results that depend on the current user, tenant, locale or permissions cached under keys that omit them → one user's data served to another. Fix: include the discriminator in `key`.
- **Stampede**: expensive `@Cacheable` methods without `sync = true` → concurrent misses all recompute and hammer the backend. Fix: `sync = true` or a loading cache.
- **Eviction timing**: `@CacheEvict` runs only after a successful return (skipped on exceptions); evicting inside a transaction lets others re-cache the old row before commit. Fix: `TransactionAwareCacheManagerProxy` or evict after commit.
- **Cached nulls**: caching `null`/`Optional.empty()` for "not found" hides rows created later until expiry. Fix: `unless = "#result == null"` or short TTLs.
