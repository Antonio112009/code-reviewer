---
name: Event loop, worker and virtual threads
description: Quarkus threading defects — blocking calls in endpoints returning Uni/Multi/CompletionStage (event loop), misplaced @NonBlocking, mixing JTA and reactive transactions, lazy Uni never subscribed, await() on I/O threads and @RunOnVirtualThread limits.
priority: 68
tags: [CWE-400, CWE-833]
activation:
  content:
    - '\b(?:Uni|Multi|CompletionStage)<'
    - '@(?:Blocking|NonBlocking|RunOnVirtualThread|WithTransaction|WithSession|WithSessionOnDemand)\b'
    - '\.await\(\)'
    - '@RegisterRestClient\b'
sources:
  - https://quarkus.io/guides/rest
  - https://quarkus.io/guides/virtual-threads
  - https://quarkus.io/guides/hibernate-reactive-panache
---
- **Blocking on the event loop**: endpoints returning `Uni`, `Multi`, `CompletionStage` or `Publisher` (or Kotlin `suspend`) run on the Vert.x I/O thread → JDBC/Hibernate ORM, blocking REST clients or `Thread.sleep` there freeze request handling. Fix: `@Blocking` or reactive clients.
- **@NonBlocking on blocking code**: plain return types run on worker threads; `@NonBlocking` moves them to the I/O thread with the same freeze risk. Fix: use it only for truly non-blocking code.
- **Mixed transaction stacks**: `@Transactional` (JTA) marks a method blocking; Hibernate Reactive needs `@WithTransaction`/`@WithSession`, and mixing them with `@Transactional` in one application is prohibited. Fix: one persistence stack per code path.
- **Lazy Uni**: building a `Uni` (a client call, `entity.persist()`) and neither returning nor subscribing it → nothing runs; `.await().indefinitely()` on an I/O thread fails or deadlocks. Fix: compose and return the `Uni`.
- **@RunOnVirtualThread (JDK 21+)**: valid only where a worker thread would run (not on `Uni`/`Multi` methods); on JDK 21–23 `synchronized` blocking (e.g., older JDBC drivers) pins carriers; CPU-bound work monopolizes them. Fix: JDK 24+, I/O-bound endpoints only.
