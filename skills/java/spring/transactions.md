---
name: Declarative transactions
description: '@Transactional semantics that lose or corrupt data — checked exceptions committing, rollback-only UnexpectedRollbackException, REQUIRES_NEW pool deadlocks, read-only flush mode, side effects inside transactions, @TransactionalEventListener phases and async boundaries.'
priority: 70
tags: [CWE-755, CWE-662]
activation:
  content:
    - '@Transactional(?:EventListener)?\b'
    - '\bTransactionTemplate\b'
    - '\bPropagation\.[A-Z_]+'
    - '\bsetRollbackOnly\('
  examples:
    - '@Transactional(propagation = Propagation.REQUIRES_NEW)'
    - 'TransactionTemplate template = new TransactionTemplate(manager);'
    - 'status.setRollbackOnly();'
sources:
  - https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/rolling-back.html
  - https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html
  - https://docs.spring.io/spring-framework/reference/data-access/transaction/event.html
  - https://docs.spring.io/spring-data/jpa/reference/jpa/transactions.html
---
- **Checked exceptions commit**: only `RuntimeException`/`Error` roll back by default → a checked exception commits partial writes. Fix: `rollbackFor = Exception.class`, or `@EnableTransactionManagement(rollbackOn = ALL_EXCEPTIONS)` (Spring 6.2+).
- **Swallowed inner failure**: catching an exception from an inner `@Transactional` (REQUIRED) call and continuing → the shared transaction is rollback-only and commit throws `UnexpectedRollbackException`. Fix: let it propagate, or `REQUIRES_NEW` for independent work.
- **REQUIRES_NEW pressure**: each inner `REQUIRES_NEW` takes a second connection while the outer one waits → pool deadlock under load; inner commits survive outer rollbacks. Fix: avoid in loops and hot paths.
- **readOnly writes**: writes inside a class-level `@Transactional(readOnly = true)` without their own annotation → Hibernate flush mode `MANUAL`, changes silently not written (read-only connections may reject them). Fix: `@Transactional` on each write method.
- **Side effects in the transaction**: HTTP calls, emails or Kafka/JMS sends happen even if the transaction later rolls back, and slow calls hold DB connections. Fix: publish after commit (`@TransactionalEventListener`, outbox).
- **After-commit listeners**: `@TransactionalEventListener` (`AFTER_COMMIT` by default) is skipped when no transaction is active unless `fallbackExecution = true`; writes inside it join the finished transaction and never commit. Fix: `@Transactional(propagation = REQUIRES_NEW)` on the listener.
- **Async boundaries**: `@Async` calls or threads started inside a transaction don't share it (thread-bound) → they miss uncommitted data or write outside it. Fix: start them after commit.
