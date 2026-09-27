---
name: Hibernate 6 and 7 upgrade traps
description: Runtime behaviour changes when moving to Hibernate 6 (Spring Boot 3) and 7 (Spring Boot 4) — per-entity sequences, new type mappings, stricter HQL, detached-entity rules, @MapsId cascades and java.time native query results.
priority: 62
activation:
  content:
    - '\.(?:merge|persist|refresh|lock)\('
    - '\bcreateNativeQuery\('
    - '@(?:MapsId|GeneratedValue|SequenceGenerator|Type|JdbcTypeCode)\b'
    - '\bhibernate_sequence\b|\bnew_generator_mappings\b'
    - '\b(?:Timestamp|Instant|Duration|UUID)\b'
  versions: { orm.hibernate: ">=6" }
sources:
  - https://docs.hibernate.org/orm/6.0/migration-guide/migration-guide.html
  - https://docs.hibernate.org/orm/7.0/migration-guide/migration-guide.html
---
- **Per-entity sequences (6)**: implicit ids use one sequence per entity hierarchy (`<entity>_seq`, allocation size 50) instead of `hibernate_sequence` → upgraded schemas lack sequences or collide with existing ids. Fix: map `@SequenceGenerator` to the existing sequence and increment.
- **Type mappings (6)**: `Instant` → `TIMESTAMP_UTC`, `Duration` → interval types, `UUID` → native uuid columns, `@Type(type = "yes_no")` removed → column mismatches or shifted timestamps. Fix: explicit `@JdbcTypeCode`/converters.
- **Stricter HQL (6)**: `from A a join a.b` returns `A` instead of `Object[]`, comparing associations to raw ids is rejected, `update … from` is invalid → runtime failures or changed result shapes. Fix: explicit `select` lists, `a.b.id = :id`.
- **Detached entities (7)**: `refresh`/`lock` on detached instances throw; persisting a new entity whose `PERSIST`-cascaded association points to a detached entity throws `EntityExistsException`. Fix: `merge` first.
- **@Id/@MapsId associations (7)**: no longer cascade `PERSIST` implicitly → transient-instance errors. Fix: declare the cascade.
- **Native query types (7)**: date/time columns come back as `java.time` types, not `java.sql.Timestamp`/`Date` → `(Timestamp) row[1]` throws `ClassCastException`. Fix: cast to `LocalDateTime`/`OffsetDateTime`, or `hibernate.query.native.prefer_jdbc_datetime_types=true`.
