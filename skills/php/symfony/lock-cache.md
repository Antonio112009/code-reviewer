---
name: Lock and Cache components
description: Symfony Lock and Cache traps — locks auto-released when the Lock object is destroyed, TTL expiry during long work, ignored acquire() results, host-local stores, cache keys missing user/tenant inputs, items that never expire and tags on non-taggable pools.
priority: 62
tags: [CWE-362, CWE-667, CWE-524]
activation:
  content:
    - '\bLockFactory\b|->createLock\s*\(|\b(?:Flock|Semaphore)Store\b|->(?:acquire|refresh)\s*\('
    - '\b(?:TagAware)?CacheInterface\b|->expiresAfter\s*\(|->invalidateTags\s*\(|\bItemInterface\b'
  examples:
    - '$lock = $this->lockFactory->createLock(''job'');'
    - '$cache->get($key, function (ItemInterface $item) { $item->expiresAfter(3600); });'
sources:
  - https://symfony.com/doc/current/components/lock.html
  - https://symfony.com/doc/current/cache.html
  - https://symfony.com/doc/current/components/cache/cache_invalidation.html
---
- **Auto-release on destruct**: a lock is released when its `Lock` object is destroyed → `$factory->createLock('job')->acquire()` without keeping the object, or a lock held in a helper's local variable, unlocks immediately. Keep a reference; use `autoRelease: false` when handing the key to other processes.
- **TTL expiry**: locks expire after their TTL (300 s default) even while work continues → a second process acquires it. Fix: `refresh()` during long work, check `isExpired()` before committing results.
- **Ignored acquire()**: non-blocking `acquire()` returns `false` when the lock is held → code that ignores the result runs without mutual exclusion.
- **Host-local stores**: `FlockStore` and `SemaphoreStore` only coordinate processes on one machine or container → no exclusion across servers, pods or overlapping deploys. Fix: Redis, PDO or another shared store.
- **Cache key scope**: `$cache->get($key, fn (ItemInterface $item) => …)` where the key omits the user, tenant or locale the callback depends on → one user's data served to others.
- **Expiry and tags**: items without `expiresAfter()` live forever in pools with no default lifetime; `invalidateTags()` needs a `TagAwareCacheInterface` pool, otherwise stale data stays.
