---
name: Spring Data repository methods
description: Repository misuse — save() merging entities with assigned ids, lazy getReferenceById proxies, derived deletes loading every row, @Modifying without clear/flush or a transaction, findAll with in-memory filtering and expensive Page counts.
priority: 62
tags: [CWE-400, CWE-1073]
activation:
  content:
    - '\bextends\s+(?:Jpa|Crud|PagingAndSorting|ListCrud|ListPagingAndSorting|Mongo|R2dbc|ReactiveCrud|ReactiveMongo)?Repository<'
    - '\.(?:save|saveAll|saveAndFlush|getReferenceById|getById|getOne|findAll|deleteAll|deleteAllInBatch)\('
    - '\b(?:delete|remove)By\w*\('
    - '@Modifying\b'
  examples:
    - 'public interface OrderRepository extends JpaRepository<Order, Long> {'
    - 'repository.saveAll(orders);'
    - 'void deleteByStatus(String status);'
    - '@Modifying @Query("update Order o set o.status = :status")'
sources:
  - https://docs.spring.io/spring-data/jpa/reference/jpa/entity-persistence.html
  - https://docs.spring.io/spring-data/jpa/reference/jpa/query-methods.html
  - https://docs.spring.io/spring-data/jpa/reference/jpa/transactions.html
---
- **save() with assigned ids**: entities with a preset id (UUIDs, natural keys) and no `@Version` count as existing → `merge` adds a SELECT per save and returns another instance; edits to the original are lost. Fix: `Persistable.isNew()`, use the result.
- **Lazy references**: `getReferenceById`/`getById`/`getOne` return an uninitialized proxy without querying → `EntityNotFoundException` or `LazyInitializationException` later, far from the call. Fix: `findById` when existence or state matters.
- **Derived deletes**: `deleteBy…`/`removeBy…` load every matching entity and delete them one by one. Fix: a `@Modifying @Query("delete …")` bulk delete (no callbacks or cascades).
- **@Modifying queries**: without `clearAutomatically = true` managed entities stay stale; without `flushAutomatically = true` pending changes aren't flushed first; declared query methods get no transaction by default. Fix: set the flags, add `@Transactional`.
- **findAll + Java filtering**: `findAll()` or unbounded `List` query methods followed by `stream().filter(...)` → full table loads and OOM as data grows. Fix: query predicates, `Pageable`/`Slice`, or `Stream` results inside a transaction.
- **Expensive Page**: `Page<T>` runs an extra `COUNT(*)` per request (slow on large tables and joins). Fix: `Slice<T>` when the total isn't needed, or a tuned `countQuery`.
