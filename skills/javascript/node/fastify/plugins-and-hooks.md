---
name: Plugins, encapsulation and hooks
description: Fastify encapsulation and lifecycle traps — hooks, error handlers and decorators scoped to a child plugin, fastify-plugin side effects, request decorators holding shared objects, async handlers or hooks that also use reply.send or done, and body access in onRequest.
priority: 64
tags: [CWE-862, CWE-362]
activation:
  content:
    - "\\bfastify-plugin\\b|\\bfp\\s*\\("
    - "\\.(?:register|addHook|decorate(?:Request|Reply)?|setErrorHandler|setNotFoundHandler)\\s*\\("
    - "\\breply\\.(?:send|hijack)\\s*\\(|\\breturn\\s+reply\\b"
    - "\\bdone\\s*\\(\\s*\\)"
  examples:
    - 'module.exports = fp(userRoutes);'
    - 'fastify.addHook(''onRequest'', authenticate);'
    - 'return reply.send({ ok: true });'
    - 'done();'
sources:
  - https://fastify.dev/docs/latest/Reference/Encapsulation/
  - https://fastify.dev/docs/latest/Reference/Hooks/
  - https://fastify.dev/docs/latest/Reference/Decorators/
  - https://fastify.dev/docs/latest/Reference/Routes/
---
- **Encapsulated guards**: `addHook('onRequest', auth)` or `setErrorHandler()` inside a plugin passed to `register()` covers only that plugin and its children — routes in sibling plugins stay unprotected. Fix: register guards in the scope owning the routes.
- **fastify-plugin both ways**: decorators (`fastify.db`, `request.user`) from a plain plugin are `undefined` in siblings; wrapping route plugins with `fp()` leaks their hooks to every parent route and ignores `prefix`.
- **Shared request decorators**: `decorateRequest('user', {})` or `[]` shares one object across all requests in v4 (cross-request data leaks); v5 throws at boot. Fix: `decorateRequest('user', null)`, assign in `onRequest`.
- **Async plus reply.send**: an async handler calling `reply.send()` from a callback without `return reply` resolves `undefined` → error or double response; sending and also returning a value discards one. Fix: return the payload, or `return reply`.
- **Early replies in hooks**: an async `onRequest`/`preHandler` that sends 401 must `return reply`, or the route handler still runs; mixing `async` with `done()` runs handlers twice.
- **Body in onRequest**: `request.body` is always `undefined` in `onRequest` (parsed later) → body-based signature or auth checks there pass vacuously or crash. Fix: `preValidation`/`preHandler`.
- **After-response hooks**: `onResponse` can't send, `reply.send` in `onError` throws, and `preSerialization` skips string/Buffer/stream payloads — redaction placed there misses responses.
