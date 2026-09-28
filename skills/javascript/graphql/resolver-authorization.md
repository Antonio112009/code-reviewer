---
name: Resolver authorization
description: GraphQL authorization gaps in JS servers — checks only on root fields, sensitive fields reachable through other types, node/global IDs and federation reference resolvers that skip ownership checks, and allow-by-default rule sets.
priority: 68
tags: [CWE-862, CWE-639, CWE-285]
activation:
  content:
    - "\\b__resolveReference\\b|\\b(?:fromGlobalId|toGlobalId|decodeGlobalID)\\s*\\("
    - "@(?:Authorized|UseGuards|ResolveField|FieldResolver)\\s*\\("
    - "\\bshield\\s*\\(|\\bgraphql-shield\\b|\\bfallbackRule\\b|\\bauthChecker\\b"
    - "\\b(?:context|ctx)\\.(?:user|auth|session|viewer|currentUser)\\b"
    - "\\b(?:Query|Mutation|Subscription)\\s*:\\s*\\{"
  examples:
    - '__resolveReference(ref) { return getById(ref.id); },'
    - '@UseGuards(AuthGuard)'
    - 'const permissions = shield({ Query: isAuthenticated });'
    - 'if (!ctx.user) throw new Error(''unauthorized'');'
    - 'Query: { order: (parent, args, ctx) => resolveOrder(args) },'
sources:
  - https://graphql.org/learn/authorization/
  - https://www.apollographql.com/docs/graphos/schema-design/federated-schemas/entities/intro
  - https://github.com/maticzav/graphql-shield/blob/master/packages/graphql-shield/src/shield.ts
---
- **Root-only checks**: permission checked in `Query.order` while `Order` is also reachable via `user.orders`, `search`, `node(id:)` or mutation payloads → the same data without the check. Fix: authorize in type/field resolvers or the shared data layer.
- **Field-level data**: fields like `User.email`, `User.phone` or `Invoice.total` resolved straight from the parent object leak through any query that reaches the type. Fix: viewer checks in those field resolvers, or separate public types.
- **Global IDs**: `fromGlobalId(id)`/decoded `node(id:)` values used without checking the decoded type and ownership load another type's or tenant's object. Fix: verify type, then ACL, after decoding.
- **Federation references**: `__resolveReference` loads entities by key for the router without the checks root fields apply, and subgraphs reachable directly skip router authentication. Fix: authorize in reference resolvers; keep subgraphs private.
- **Allow by default**: graphql-shield's `fallbackRule` is `allow`, and `@Authorized`/directive checks cover only annotated fields — new fields and `extend type` additions are public. Fix: deny-by-default fallback, tests for unauthenticated access.
