---
name: NestJS 11 behaviour changes
description: Behaviour that changed with NestJS 11 — Express 5 route syntax, reversed termination hook order, ConfigService preferring load() factories over process.env, cache-manager v6/Keyv stores and dynamic modules no longer deduplicated.
priority: 62
activation:
  versions: { framework.nestjs: ">=11" }
  content:
    - "@(?:Get|Post|Put|Patch|Delete|All|Controller)\\s*\\(\\s*['\"][^'\"\\n]{0,80}[*?+()]|\\bforRoutes\\s*\\(|\\bexclude\\s*\\(\\s*['\"]"
    - "\\bon(?:ModuleDestroy|ApplicationShutdown)\\s*\\(|\\bbeforeApplicationShutdown\\s*\\("
    - "\\bConfigModule\\.forRoot\\s*\\(|\\bskipProcessEnv\\b|\\bregisterAs\\s*\\(|\\bload\\s*:\\s*\\["
    - "\\bCacheModule\\.register(?:Async)?\\s*\\(|\\bcreateKeyv\\s*\\(|@keyv/|\\bredisStore\\b|\\bstores?\\s*:"
    - "\\.(?:forRoot|forRootAsync|register|registerAsync)\\s*\\("
sources:
  - https://trilon.io/blog/announcing-nestjs-11-whats-new
  - https://docs.nestjs.com/techniques/configuration
  - https://docs.nestjs.com/techniques/caching
  - https://docs.nestjs.com/middleware
---
- **Express 5 paths**: on the Express adapter, `?` optionals, `+` and regex parameter constraints (`':id(\\d+)'`) are no longer supported and wildcards should be named (`'{*splat}'`); unmigrated routes fail at startup or stop matching. Fix: rewrite and test each pattern.
- **Reversed shutdown order**: `onModuleDestroy`/`onApplicationShutdown` now run in reverse module order — a hook that flushes through another module's connection may find it already closed. Fix: explicit dependencies, idempotent cleanup.
- **Config precedence**: `ConfigService#get` now prefers values from `load` factories over `process.env`, so runtime env overrides (Kubernetes, CI) stop winning for keys a factory also defines. Fix: read env inside the factory; `skipProcessEnv` deliberately.
- **Cache stores**: `@nestjs/cache-manager` uses cache-manager v6 with Keyv — legacy `store: redisStore` configs must become Keyv adapters (`stores: [createKeyv(url)]`), TTLs are milliseconds and omitting `ttl` never expires. Fix: migrate the store config and set `ttl`.
- **Dynamic module identity**: identical `forRoot()`/`register()` modules imported in several places are now separate instances instead of being merged → duplicate connections, caches and schedulers. Fix: import once in a shared (global) module.
