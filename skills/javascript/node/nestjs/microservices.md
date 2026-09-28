---
name: Microservice clients and handlers
description: NestJS microservice pitfalls — ClientProxy.send() observables that never fire without a subscriber, calls without timeouts, unobserved emit() failures, hybrid apps not inheriting global pipes/guards, RabbitMQ auto-ack losing messages and HttpExceptions in RPC handlers.
priority: 64
tags: [CWE-400, CWE-754, CWE-862]
activation:
  content:
    - "\\bClientProxy\\b|\\bClientsModule\\b|@Client\\s*\\(|\\.(?:send|emit)\\s*(?:<[^>\\n]{0,80}>)?\\s*\\(\\s*(?:\\{|['\"][\\w.:/-]+['\"])"
    - "@(?:MessagePattern|EventPattern|Payload|Ctx)\\s*\\("
    - "\\bRpcException\\b|\\bTransport\\.\\w+\\b|\\b(?:createMicroservice|connectMicroservice)\\s*\\(|\\bnoAck\\b"
  examples:
    - 'private readonly client: ClientProxy'
    - '@MessagePattern("orders.created")'
    - 'throw new RpcException("Invalid order")'
sources:
  - https://docs.nestjs.com/microservices/basics
  - https://docs.nestjs.com/faq/hybrid-application
  - https://docs.nestjs.com/microservices/rabbitmq
  - https://docs.nestjs.com/microservices/exception-filters
---
- **Cold send()**: `client.send()` returns a cold Observable — nothing is sent until subscribed, so `this.client.send('pattern', data)` without `firstValueFrom()`/`subscribe()` silently does nothing. Fix: `await firstValueFrom(client.send(...))`.
- **No timeout**: request-response calls without the RxJS `timeout` operator wait forever when the other service is down or never replies → piling requests and exhausted pools. Fix: `.pipe(timeout(5000))` plus a fallback.
- **Unobserved emit()**: `emit()` is hot and fire-and-forget — ignoring its observable means broker or serialisation failures go unnoticed and events are lost. Fix: subscribe for errors; outbox for events that must arrive.
- **Hybrid apps**: `connectMicroservice()` doesn't inherit global pipes, guards, interceptors or filters unless `{ inheritAppConfig: true }` is passed after the `useGlobal*()` calls → message handlers run unauthenticated and unvalidated.
- **RabbitMQ auto-ack**: the RMQ transport defaults to `noAck: true`, so a message whose handler throws is already acknowledged and lost. Fix: `noAck: false` with `channel.ack()` after success (and `nack` policy).
- **Wrong exception type**: throwing `HttpException` (or letting `ValidationPipe`'s `BadRequestException` escape) in `@MessagePattern` handlers doesn't map to RPC errors — callers get generic "Internal server error". Fix: `RpcException`, pipe `exceptionFactory`.
