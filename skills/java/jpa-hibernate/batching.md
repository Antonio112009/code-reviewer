---
name: Batch writes and bulk processing
description: Slow or memory-hungry bulk writes — IDENTITY ids disabling JDBC batching, batch size never configured, persistence contexts growing without flush/clear and StatelessSession batching assumptions in Hibernate 7.
priority: 58
tags: [CWE-400]
activation:
  content:
    - '\bGenerationType\.IDENTITY\b'
    - '\bbatch_size\b|\bjdbc\.batch'
    - '\.(?:saveAll|persist|flush|clear)\('
    - '\bStatelessSession\b'
    - '@(?:GeneratedValue|SequenceGenerator)\b'
  examples:
    - '@GeneratedValue(strategy = GenerationType.IDENTITY)'
    - 'hibernate.jdbc.batch_size=50'
    - 'repository.saveAll(batch);'
    - 'StatelessSession session = sessionFactory.openStatelessSession();'
sources:
  - https://github.com/hibernate/hibernate-orm/blob/main/documentation/src/main/asciidoc/userguide/chapters/batch/Batching.adoc
  - https://docs.hibernate.org/orm/7.0/migration-guide/migration-guide.html
---
- **IDENTITY disables batching**: with `GenerationType.IDENTITY` Hibernate inserts one row per statement (it needs each generated key) → `saveAll` or imports of thousands of rows mean thousands of round trips. Fix: `SEQUENCE` with a pooled optimizer.
- **Batching not configured**: without `hibernate.jdbc.batch_size` (plus `order_inserts`/`order_updates`) every statement is sent individually. Fix: set a batch size (e.g., 20–50).
- **Growing persistence context**: persisting or updating thousands of entities in one transaction without periodic `flush()` + `clear()` → memory growth, slower dirty checking, OOM. Fix: flush and clear every batch, or use a `StatelessSession`.
- **StatelessSession in Hibernate 7**: ignores `hibernate.jdbc.batch_size` and uses the second-level cache by default; it never cascades or dirty-checks. Fix: `setJdbcBatchSize()`/`insertMultiple`, write children explicitly.
