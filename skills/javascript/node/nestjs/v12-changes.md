---
name: NestJS 12 behaviour changes
description: Behaviour that changed with NestJS 12 — ESM-only packages under Jest/CommonJS, Standard Schema route options that need their pipe, @Optional no longer inherited, hierarchy-ordered lifecycle hooks, Terminus indicator API and removed GraphQL/NATS transports.
priority: 62
activation:
  versions: { framework.nestjs: ">=12" }
  content:
    - "@(?:Body|Query|Param|RawBody)\\s*\\(\\s*(?:['\"][^'\"\\n]{0,60}['\"]\\s*,\\s*)?\\{[^}\\n]{0,80}\\bschema\\b|\\bStandardSchema\\w*\\b"
    - "@Optional\\s*\\(|\\bextends\\s+\\w+(?:Service|Repository|Provider)\\b"
    - "\\bHealthCheckError\\b|\\bHealthIndicator(?:Service)?\\b|\\bindicator\\.(?:up|down)\\s*\\("
    - "\\bsubscriptions-transport-ws\\b|['\"]graphql-ws['\"]|\\bTransport\\.NATS\\b|\\b(?:StringCodec|JSONCodec)\\b|@nats-io/"
    - "\\bjest\\.config\\b|\\bts-jest\\b|\\brequire\\s*\\(\\s*['\"]@nestjs/"
  examples:
    - '@Body({ schema: CreateUserSchema }) body: CreateUserDto'
    - 'constructor(@Optional() private readonly cache?: CacheService) {}'
    - 'return indicator.down("disk", { message: "low space" })'
    - 'import { connect } from "@nats-io/transport-node"'
    - 'import config from "./jest.config.js"'
sources:
  - https://docs.nestjs.com/migration-guide
  - https://trilon.io/blog/nestjs-12-is-now-available
  - https://docs.nestjs.com/techniques/validation
---
- **Schema option needs its pipe**: `@Body({ schema })`/`@Query({ schema })` only attach metadata — without `StandardSchemaValidationPipe` registered, the input is not validated at all. Fix: register the pipe globally and test a rejected payload.
- **@Optional() not inherited**: optional markers are read with `getOwnMetadata` — subclasses without their own constructor now throw `UnknownDependenciesException` at boot instead of receiving `undefined`. Fix: redeclare `@Optional()` in the subclass.
- **Lifecycle order**: `onModuleInit`, `onApplicationBootstrap` and shutdown hooks now run by module hierarchy — init logic that relied on declaration order between dependent modules may run earlier or later. Fix: await explicit dependencies.
- **ESM-only packages**: core packages ship as ESM; CommonJS apps load them through `require(esm)` (Node ≥20.19/22.12), but Jest in CommonJS fails with `ERR_REQUIRE_ASYNC_MODULE` before Node 24.9. Fix: Vitest or ESM Jest config.
- **Terminus indicators**: custom health indicators must use `HealthIndicatorService` and return `indicator.down()` — the old extend-`HealthIndicator`/throw-`HealthCheckError` pattern no longer reports the service as down.
- **Removed transports**: GraphQL subscriptions require `graphql-ws` (`subscriptions-transport-ws` removed); NATS moved to `@nats-io/transport-node` v3 without `StringCodec`/`JSONCodec`, and custom deserializers receive the whole message.
