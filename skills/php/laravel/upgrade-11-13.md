---
name: Laravel 11–13 behaviour changes
description: Silent behaviour changes after upgrading to Laravel 11, 12 or 13 — rate-limit seconds, password rehash column, UUIDv7, container nullable defaults, PreventRequestForgery origin checks, cache/session prefixes and the array_first polyfill.
priority: 64
tags: [CWE-1329, CWE-440]
activation:
  versions: { framework.laravel: ">=11" }
  files: ["**/composer.json"]
  content:
    - '\bnew\s+(?:Limit|GlobalLimit|ThrottlesExceptions\w*)\s*\(|\bdecayMinutes\b|\bHasUuids\b'
    - '\b(?:PreventRequestForgery|VerifyCsrfToken|ValidateCsrfToken)\b|\barray_(?:first|last)\s*\('
    - '\b(?:CACHE_PREFIX|REDIS_PREFIX|SESSION_COOKIE)\b|\bauthPasswordName\b'
sources:
  - https://laravel.com/docs/11.x/upgrade
  - https://laravel.com/docs/12.x/upgrade
  - https://laravel.com/docs/13.x/upgrade
---
- **Rate limits in seconds (11)**: `new Limit($key, $attempts, 2)` and `ThrottlesExceptions` constructors now take seconds (`decayMinutes` became `decaySeconds`) → hand-built limits expire 60× sooner.
- **Password rehash (11)**: passwords are rehashed on login when the cost changes; a column not named `password` needs `authPasswordName`; set `rehash_on_login` false if other systems verify the hashes.
- **UUIDv7 (12)**: `HasUuids` now generates time-ordered v7 ids that reveal creation time → do not use them as unguessable tokens; `HasVersion4Uuids` keeps v4.
- **Nullable defaults (12/13)**: the container now honours `?Service $s = null` defaults for constructors (12) and `Container::call` (13) → injected services arrive as `null`.
- **PreventRequestForgery (13)**: CSRF middleware also verifies the `Sec-Fetch-Site` origin, and `VerifyCsrfToken` is a deprecated alias → cross-site posts (payment returns, SSO) may get 419s; update exclusions.
- **Prefixes (13)**: default cache, Redis and session-cookie names changed when `CACHE_PREFIX`, `REDIS_PREFIX`, `SESSION_COOKIE` are unset → everyone logged out, caches cold, shared Redis keys unseen.
- **array_first polyfill (13)**: on PHP < 8.5 the polyfilled `array_first($array)` can win over `laravel/helpers` → `array_first($items, $callback)` ignores the callback and returns the first element. Fix: `Arr::first()`.
