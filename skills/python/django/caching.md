---
name: Caching
description: Django cache defects — per-view and fragment caches that serve one user's data to others, cache keys missing user or tenant scope, timeout 0/None semantics, eager get_or_set defaults and per-process LocMemCache used for shared state.
priority: 64
tags: [CWE-524, CWE-200]
activation:
  content:
    - '\b(?:cache_page|cache_control|never_cache|vary_on_cookie|vary_on_headers|CacheMiddleware|UpdateCacheMiddleware)\b'
    - '\{%-?\s*cache\s'
    - '\bcache(?:s\[[^\]\n]{1,40}\])?\.(?:get|set|add|get_or_set|set_many|get_many|delete|incr|decr|touch)\('
    - '\bLocMemCache\b|\bCACHES\s*='
sources:
  - https://docs.djangoproject.com/en/stable/topics/cache/
  - https://docs.djangoproject.com/en/stable/releases/6.0.6/
---
- **Shared per-view cache**: `@cache_page` does not vary by user, session or cookies, and caches before response middleware adds `Vary: Cookie` → one user's page is served to others. Fix: `vary_on_cookie`, `private` cache control, or no page caching.
- **Authorization-header APIs**: before 6.0.6 / 5.2.15, responses to requests with an `Authorization` header were cached without varying on it (CVE-2026-35193). Fix: upgrade or `vary_on_headers("Authorization")`.
- **Fragment cache without scope**: `{% cache 600 sidebar %}` around user-specific content lacks `request.user.pk` in its vary-on arguments → cross-user leakage.
- **Unscoped keys**: `cache.get("profile")` or keys missing user, tenant, language or schema version → wrong or stale data across users and deploys.
- **Timeout semantics**: `timeout=0` expires immediately (nothing is cached); `timeout=None` never expires → unbounded growth or permanently stale values.
- **Eager default**: `cache.get_or_set(key, compute())` runs `compute()` on every call. Fix: pass the callable itself.
- **Per-process LocMemCache**: rate limits, locks or one-time tokens in the default `LocMemCache` are not shared between workers or hosts → limits bypassed. Fix: Redis/Memcached for shared state.
