---
name: Memoization with functools caches
description: lru_cache/cache pitfalls — methods pinning self, unbounded growth, shared mutable results, caching coroutines of async functions, impure functions frozen forever, unhashable or split cache keys and cross-user leaks.
priority: 55
tags: [CWE-401]
activation:
  content:
    - "@(?:functools\\.)?(?:lru_cache|cache)\\b"
    - "\\b(?:lru_cache|cache_clear|cache_info)\\s*\\("
    - "\\b(?:TTLCache|LRUCache|cachetools)\\b"
sources:
  - https://docs.python.org/3/library/functools.html#functools.lru_cache
  - https://docs.python.org/3/faq/programming.html#how-do-i-cache-method-calls
---
- **Methods pin `self`**: `@lru_cache`/`@cache` on instance methods keys on `self`, keeping every instance (and everything it references) alive until evicted — forever with `@cache` → memory leaks in long-running processes. Fix: cache a module-level function of the needed fields.
- **Unbounded caches**: `@cache` or `lru_cache(maxsize=None)` keyed on user ids, request strings, paths or timestamps grows without limit. Fix: a bounded `maxsize` or a TTL cache.
- **Mutable results**: a cached function returning a list, dict or object hands the same object to every caller → one caller's mutation corrupts all later results. Fix: return tuples/frozensets or copies.
- **Async functions**: `@lru_cache` on `async def` caches the coroutine object; the second `await` raises "cannot reuse already awaited coroutine". Fix: cache the awaited result (per-key task or an async-aware cache).
- **Impure functions**: caching functions that read config, env, DB, files, `now()` or random values freezes the first result for the process lifetime → stale settings and permissions. Fix: TTL, `cache_clear()` on change, or no cache.
- **Key surprises**: list/dict arguments raise TypeError at call time; `f(1)` and `f(1.0)` share an entry, while `f(a=1, b=2)` and `f(b=2, a=1)` are cached separately. Fix: normalize arguments first.
- **Cross-user leaks**: a cache key that omits the user, tenant or locale returns one user's data to another (and leaks results between tests). Fix: include every input that changes the result; `cache_clear()` in fixtures.
