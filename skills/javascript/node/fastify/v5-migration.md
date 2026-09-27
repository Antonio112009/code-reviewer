---
name: Fastify 5 behaviour changes
description: Fastify v5 changes that silently alter behaviour — reply.redirect argument order, request.hostname without port, semicolon query delimiters, removed request/route properties, loggerInstance, prototype-less params and stricter DELETE bodies and plugin signatures.
priority: 64
activation:
  versions: { framework.fastify: ">=5" }
  content:
    - "\\breply\\.redirect\\s*\\("
    - "\\b(?:request|req)\\.(?:hostname|routeConfig|routerPath|routerMethod|routeSchema|context|connection)\\b|\\breply\\.(?:context|getResponseTime|sent)\\b"
    - "\\blogger\\s*:\\s*(?:pino|winston|bunyan|logger|log|createLogger)\\b|\\buseSemicolonDelimiter\\b|\\bjsonShortHand\\b"
    - "\\.listen\\s*\\(\\s*(?:\\d|port\\b|PORT\\b|process\\.env)"
    - "\\bparams\\.hasOwnProperty\\s*\\(|\\bexposeHeadRoutes\\b|\\bmethod\\s*:\\s*['\"](?:HEAD|DELETE)['\"]|\\.(?:head|delete)\\s*\\("
sources:
  - https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/
  - https://fastify.dev/docs/latest/Reference/Request/
---
- **redirect order**: `reply.redirect(301, '/x')` (v4) is now `reply.redirect('/x', 301)` — unmigrated calls fail or redirect to the wrong target.
- **Host and port**: `request.hostname` no longer includes the port (`request.host` does, `request.port` is new) → host+port comparisons, tenant lookups and URL builders change.
- **Removed route properties**: `request.routeConfig`, `routerPath`, `routeSchema`, `context`, `reply.context` are gone — hooks reading `routeConfig.public`/`requiresAuth` get `undefined`, crashing or skipping checks. Fix: `request.routeOptions.config/url/schema`.
- **Semicolons**: `useSemicolonDelimiter` now defaults to `false` — `?a=1;b=2` yields `a: '1;b=2'`, breaking clients that relied on `;`.
- **Logger and listen**: a logger instance passed as `logger` must move to `loggerInstance`; `listen(port, host, cb)` is gone — use `listen({ port, host })`.
- **Prototype-less params**: `request.params` has no prototype, so `params.hasOwnProperty('id')` throws. Fix: `Object.hasOwn(params, 'id')`.
- **Stricter requests and plugins**: DELETE with `Content-Type: application/json` and an empty body is rejected; plugins mixing `async` with `done`, `reply.sent = true` (use `reply.hijack()`) and custom HEAD routes registered after the GET fail.
