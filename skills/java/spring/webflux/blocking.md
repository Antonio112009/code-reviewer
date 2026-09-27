---
name: Blocking and thread-bound context in WebFlux
description: Event-loop defects in WebFlux — blocking JDBC/JPA/RestTemplate/sleep calls on Netty threads, block() in reactive code, ThreadLocal context (MDC, SecurityContextHolder, transactions) lost across operators and bounded-elastic limits.
priority: 68
tags: [CWE-400, CWE-833]
activation:
  content:
    - '\.block(?:First|Last|Optional)?\(\s*\)'
    - '\b(?:Mono|Flux)\.(?:fromCallable|fromSupplier|defer|fromFuture)\('
    - '\bSchedulers\.'
    - '\b(?:JdbcTemplate|RestTemplate|EntityManager|JpaRepository|CrudRepository)\b'
    - '\bThread\.sleep\(|\bSecurityContextHolder\b|\bMDC\.|\bRequestContextHolder\b'
    - '@Transactional\b'
sources:
  - https://docs.spring.io/spring-framework/reference/web/webflux/new-framework.html
  - https://projectreactor.io/docs/core/release/reference/faq.html
  - https://projectreactor.io/docs/core/release/reference/advanced-contextPropagation.html
---
- **Blocking on the event loop**: JDBC/JPA repositories, `RestTemplate`, file I/O, `Thread.sleep`, `Future.get` or lock waits inside handlers/operators run on the few Netty event-loop threads → every request on that loop stalls. Fix: reactive drivers (R2DBC, WebClient) or `Mono.fromCallable(...).subscribeOn(Schedulers.boundedElastic())`.
- **block() in reactive code**: `block()`/`blockFirst()`/`blockLast()` on Netty or parallel threads throws `IllegalStateException`; elsewhere it defeats non-blocking I/O. Fix: compose with `flatMap`/`zip` and return the publisher.
- **Lost ThreadLocal context**: `SecurityContextHolder`, MDC, `RequestContextHolder` and `LocaleContextHolder` values vanish across operators and threads. Fix: `ReactiveSecurityContextHolder`, Reactor `Context`, `spring.reactor.context-propagation=auto` (Boot 3.2+).
- **Transactions**: `@Transactional` on methods returning `Mono`/`Flux` needs a `ReactiveTransactionManager` (R2DBC, reactive MongoDB); JPA/JDBC transactions are thread-bound and don't cover reactive pipelines. Fix: a reactive data stack or `TransactionalOperator`.
- **Bounded elastic limits**: `Schedulers.boundedElastic()` caps threads (10 × CPU cores by default) and queued tasks → heavy blocking still saturates it; `publishOn` moves only downstream operators. Fix: move blocking work off hot paths or use a dedicated scheduler.
