---
name: Guards, metadata and authentication
description: NestJS authorization gaps — public or role metadata read from the handler only, role decorators no guard enforces, guard order, guards reading HTTP requests in GraphQL or WebSocket contexts, unguarded socket connections and JWT decode shortcuts.
priority: 68
tags: [CWE-862, CWE-863, CWE-347]
activation:
  content:
    - "\\bcanActivate\\s*\\(|\\bCanActivate\\b|@UseGuards\\s*\\(|\\bAPP_GUARD\\b|\\buseGlobalGuards\\s*\\("
    - "\\breflector\\.(?:get|getAllAndOverride|getAllAndMerge)\\b|\\bSetMetadata\\s*\\(|\\bReflector\\.createDecorator\\b"
    - "\\bhandleConnection\\s*\\(|@WebSocketGateway\\s*\\(|\\bswitchToHttp\\s*\\(|\\bGqlExecutionContext\\b"
    - "\\b(?:jwtService|jwt)\\.(?:decode|verify\\w*)\\b|\\bignoreExpiration\\b|\\bPassportStrategy\\s*\\("
sources:
  - https://docs.nestjs.com/guards
  - https://docs.nestjs.com/security/authentication
  - https://docs.nestjs.com/websockets/guards
  - https://github.com/nestjs/nest/issues/882
---
- **Handler-only metadata**: `reflector.get(IS_PUBLIC, ctx.getHandler())` ignores class-level `@Public()`/`@Roles()` — controller-wide roles go unchecked on methods without their own. Fix: `getAllAndOverride(key, [ctx.getHandler(), ctx.getClass()])`.
- **Decorators nobody enforces**: `@Roles('admin')` or `@Public()` with no guard bound (`APP_GUARD`/`@UseGuards`) or read under a different metadata key is just annotation. Fix: a global guard reading the same key.
- **Guard order**: guards run in the listed order — `@UseGuards(RolesGuard, JwtAuthGuard)` checks roles before `req.user` exists (always 403, or bypass if it treats a missing user as allowed). Fix: authentication first.
- **Non-HTTP contexts**: guards and param decorators calling `context.switchToHttp().getRequest()` in GraphQL resolvers or gateways get no HTTP request → crashes or wrong decisions. Fix: `GqlExecutionContext.create(ctx).getContext().req`, `switchToWs()`.
- **Socket connections**: gateway guards run only for `@SubscribeMessage` handlers — `handleConnection` isn't guarded, so anonymous sockets connect, join rooms and receive `server.emit` broadcasts. Fix: verify the token in `handleConnection` and `disconnect()`.
- **JWT shortcuts**: `jwtService.decode()` doesn't verify signatures, and passport-jwt `ignoreExpiration: true` accepts expired tokens. Fix: `verifyAsync()` with pinned `algorithms`, expiry enforced.
