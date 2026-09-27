---
name: Panache data access and transactions
description: Hibernate ORM/Reactive with Panache — writes outside transactions, string-concatenated simplified queries, bulk update/delete bypassing entities, listAll/streamAll misuse, reactive session rules and schema-management settings that also hit production.
priority: 64
tags: [CWE-89, CWE-400, A05:2025]
activation:
  content:
    - '\bPanache(?:Entity(?:Base)?|Repository(?:Base)?|MongoEntity|Query)\b'
    - '\.(?:persist|persistAndFlush|listAll|streamAll|findAll|deleteAll|findById)\('
    - '\.(?:find|list|stream|update|delete|count)\(\s*"'
    - '\b(?:schema-management|database\.generation)\b'
    - '\bQuarkusTransaction\b'
sources:
  - https://quarkus.io/guides/hibernate-orm-panache
  - https://quarkus.io/guides/hibernate-reactive-panache
  - https://quarkus.io/guides/hibernate-orm
---
- **Writes without a transaction**: `persist()`, `delete()` or `update()` outside `@Transactional`/`QuarkusTransaction` → `TransactionRequiredException` or changes never flushed. Fix: demarcate at the service or endpoint entry point.
- **Concatenated queries**: `find("name = '" + input + "'")` or `list("order by " + sort)` → HQL injection. Fix: `find("name", value)`, `?1`/`:name` parameters, `Sort.by(...)` over allow-listed fields.
- **Bulk operations**: `update(...)`, `delete(query)` and `deleteAll()` run directly in the database, bypassing the persistence context, entity listeners and cascades → stale managed entities, no auditing. Fix: modify entities when callbacks matter.
- **Loading everything**: `listAll()`/`findAll().list()` on growing tables → OOM; `streamAll()` needs an active transaction and must be closed. Fix: `page(...)`/`range(...)`, try-with-resources streams.
- **Reactive Panache**: entities can't be used from blocking threads, `@Transactional` must not be mixed with `@WithTransaction`/`@WithSession`, and changes flush at commit → constraint errors surface late. Fix: `persistAndFlush()`/`flush()` where errors are handled.
- **Schema management in prod**: `quarkus.hibernate-orm.schema-management.strategy` (formerly `database.generation`) set to `drop-and-create`/`update` without a `%dev.`/`%test.` prefix → applies in production and drops or mutates data. Fix: profile-prefix it; Flyway/Liquibase in prod.
