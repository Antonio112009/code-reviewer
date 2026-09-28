---
name: Providers, scopes and lifecycle
description: NestJS DI and lifecycle defects — request scope bubbling into controllers and unsupported classes, forwardRef cycles, config values that are always strings or read before loading, shutdown hooks that never run and cron jobs duplicated per replica.
priority: 64
tags: [CWE-362, CWE-665]
activation:
  content:
    - "\\bScope\\.(?:REQUEST|TRANSIENT)\\b|@Inject\\s*\\(\\s*REQUEST\\b|\\bforwardRef\\s*\\(|\\bdurable\\s*:"
    - "\\bConfigModule\\.forRoot\\s*\\(|\\bconfigService\\.get\\w*\\b|\\bprocess\\.env\\.\\w+"
    - "\\benableShutdownHooks\\s*\\(|\\bon(?:ModuleInit|ModuleDestroy|ApplicationBootstrap|ApplicationShutdown)\\s*\\(|\\bbeforeApplicationShutdown\\s*\\("
    - "@(?:Cron|Interval|Timeout)\\s*\\("
  examples:
    - '@Injectable({ scope: Scope.REQUEST })'
    - 'const port = configService.get<number>("PORT")'
    - 'app.enableShutdownHooks()'
    - '@Cron("0 0 * * *")'
sources:
  - https://docs.nestjs.com/fundamentals/injection-scopes
  - https://docs.nestjs.com/fundamentals/lifecycle-events
  - https://docs.nestjs.com/techniques/configuration
  - https://docs.nestjs.com/fundamentals/circular-dependency
---
- **Request scope bubbles**: `Scope.REQUEST` (or injecting `REQUEST`), the usual fix for per-request state, makes every consumer request-scoped — rebuilt per request, lifecycle hooks skipped; gateways, Passport strategies and `@Cron` classes must stay singletons. Fix: nestjs-cls or `AsyncLocalStorage`.
- **forwardRef cycles**: with circular dependencies the instantiation order is indeterminate — using the `forwardRef` dependency in a constructor or field initialiser can hit `undefined`. Fix: break the cycle, or use it only after `onModuleInit`.
- **Config values are strings**: `configService.get<number>('PORT')`/`get<boolean>(…)` only cast the type — env values are strings (`'false'` is truthy) and missing keys are `undefined` without `validate`/`validationSchema`. Fix: validate and coerce at load.
- **Env read too early**: `process.env.X` in decorators, module-level constants or `@Module` metadata runs before `ConfigModule` loads `.env`. Fix: `forRootAsync`/`registerAs` factories, `ConfigModule.envVariablesLoaded`.
- **No shutdown hooks**: without `app.enableShutdownHooks()`, `onModuleDestroy`/`onApplicationShutdown` run only on `app.close()` — SIGTERM from Kubernetes kills in-flight work and never closes pools or consumers.
- **Cron per replica**: `@Cron`/`@Interval` fire in every instance and worker → duplicate e-mails, charges and cleanups. Fix: distributed lock, leader election or a queue.
