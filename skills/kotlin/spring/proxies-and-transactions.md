---
name: Spring proxies, coroutines and repositories
description: Kotlin + Spring runtime surprises — hand-opened classes whose final methods bypass proxies, @Transactional on suspend functions with JPA/JDBC transaction managers, and non-null Spring Data return types that throw on empty results.
priority: 64
tags: [CWE-670, CWE-362]
activation:
  content:
    - '@(?:Transactional|Cacheable|CachePut|CacheEvict|Async|PreAuthorize|PostAuthorize|Retryable|Validated)\b'
    - '\bopen\s+(?:class|fun)\b'
    - '\bsuspend\s+fun\b'
    - '\b(?:JpaRepository|CrudRepository|CoroutineCrudRepository|PagingAndSortingRepository|ListCrudRepository)\s*<'
    - '\bfun\s+(?:find|get|read|query|search)By\w*\s*\('
    - '\bTransactionalOperator\b|\bexecuteAndAwait\b'
  examples:
    - '@Transactional fun placeOrder(order: Order) {'
    - 'open class OrderService(private val repo: OrderRepository) {'
    - 'suspend fun syncInventory() {'
    - 'interface OrderRepository : JpaRepository<Order, Long>'
    - 'fun findByEmail(email: String): User?'
    - 'transactionalOperator.executeAndAwait { repo.save(order) }'
sources:
  - https://kotlinlang.org/docs/all-open-plugin.html#spring-support
  - https://docs.spring.io/spring-framework/reference/languages/kotlin/coroutines.html
  - https://docs.spring.io/spring-framework/reference/data-access/transaction/strategies.html
  - https://docs.spring.io/spring-data/commons/reference/repositories/null-handling.html
---
- **Hand-opened classes**: without `kotlin("plugin.spring")`, a hand-`open` class keeps `final` methods → CGLIB can't override them: `@Transactional`/`@Cacheable`/`@Async`/`@PreAuthorize` are skipped and the call runs on the proxy, whose injected fields are `null`. Fix: the all-open Spring plugin.
- **Transactions in suspend functions**: coroutine transactions use reactive transaction management (`ReactiveTransactionManager`, R2DBC/Mongo); JPA/JDBC transactions are thread-bound, so a `@Transactional suspend fun` that suspends or switches threads runs later statements outside it. Fix: non-suspend transactional services via `withContext(Dispatchers.IO)`.
- **Non-null repository results**: a Kotlin repository method declared `fun findByEmail(email: String): User` throws `EmptyResultDataAccessException` when nothing matches → 500 for an ordinary "not found". Fix: declare `User?` (or `findByIdOrNull`) and handle absence.
