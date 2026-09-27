---
name: Subscriptions over graphql-ws
description: GraphQL subscription defects — unauthenticated connections, context computed once per subscription, onSubscribe skipping validation, events published without per-subscriber filtering, in-memory PubSub across instances and leaked async iterators.
priority: 62
tags: [CWE-306, CWE-639, CWE-400]
activation:
  content:
    - "\\bgraphql-ws\\b|\\buseServer\\s*\\(|\\bmakeServer\\s*\\(|\\bonConnect\\s*[:(]|\\bonSubscribe\\s*[:(]|\\bconnectionParams\\b"
    - "\\bPubSub\\b|\\bwithFilter\\s*\\(|\\bpubsub\\.(?:publish|subscribe|asyncIterator|asyncIterableIterator)\\s*\\(|\\bSubscription\\s*:\\s*\\{"
    - "\\bsubscriptions-transport-ws\\b|\\bSubscriptionServer\\b|@Subscription\\s*\\("
sources:
  - https://the-guild.dev/graphql/ws/docs/server/interfaces/ServerOptions
  - https://github.com/enisdenjo/graphql-ws/blob/master/src/server.ts
  - https://www.apollographql.com/docs/apollo-server/data/subscriptions
---
- **Connection auth**: `useServer` without an `onConnect` that verifies `connectionParams` (return `false` → 4403) accepts anonymous sockets; `onConnect` runs once, so revoked or expired tokens keep streaming. Fix: authenticate on connect; close sockets on expiry.
- **Context once per operation**: graphql-ws evaluates the `context` function when a subscription starts, not per event — permissions and tenant captured then stay in force. Fix: re-check rights when filtering or resolving each payload.
- **onSubscribe returning args**: returning `ExecutionArgs` from `onSubscribe` (persisted queries, custom context) skips graphql-ws's own validation → invalid or malicious documents execute. Fix: run `validate(schema, document)` yourself.
- **Unfiltered topics**: publishing to shared topics (`ORDER_UPDATED`) without `withFilter` or ownership checks sends every tenant's events to every subscriber. Fix: per-user/tenant topics or filters.
- **In-memory PubSub**: `PubSub` from `graphql-subscriptions` is process-local — with more than one instance, events published on one pod never reach subscribers on others. Fix: Redis/Kafka-backed PubSub.
- **Iterator cleanup and legacy transport**: custom async iterators without `return()` cleanup leak listeners after disconnects; `subscriptions-transport-ws` is unmaintained (dropped by NestJS 12). Fix: generators with `finally`; migrate to graphql-ws.
