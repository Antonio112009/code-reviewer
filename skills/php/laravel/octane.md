---
name: Laravel Octane state
description: Code running under Laravel Octane (Swoole, RoadRunner, FrankenPHP) — singletons capturing the request, container or config, state cached in application singletons, static caches, auth snapshots and Octane cache/table scope.
priority: 64
tags: [CWE-488, CWE-401]
activation:
  files: ["**/config/octane.php"]
  content:
    - '\bLaravel\\Octane\\|\bOctane::'
    - '\bOCTANE_\w+|\boctane:(?:start|reload)\b'
sources:
  - https://laravel.com/docs/13.x/octane#dependency-injection-and-octane
  - https://laravel.com/docs/13.x/octane#managing-memory-leaks
  - https://laravel.com/docs/13.x/octane#the-octane-cache
  - https://github.com/laravel/octane/blob/2.x/src/Concerns/ProvidesDefaultConfigurationOptions.php
---
- **Captured request, container or config**: services registered with `singleton()` that receive `Request`, `Application` or the config repository in their constructor keep the first request's values → later users see another user's input, locale or auth. Fix: `bind()`/`scoped()`, resolver closures, or pass values per call.
- **Own singletons keep state**: Octane sandboxes config, the URL generator, auth, session and locale per request, but properties cached inside your own singletons (current tenant, user, feature flags) carry over to the next request. Fix: `scoped()` bindings or flush in an Octane `RequestReceived` listener.
- **Static caches**: static arrays and properties filled per request grow for the worker's life (restarts only every 500 requests by default) and serve data across users. Fix: request-scoped storage.
- **Auth snapshots**: `auth()->user()` or `Auth::guard()` resolved into a singleton's property is stale for the next request. Fix: resolve at call time.
- **Octane cache and tables**: `Cache::store('octane')` and Swoole tables live in one server's memory and vanish on restart → not a shared or durable cache; locks and counters there are per-server.
