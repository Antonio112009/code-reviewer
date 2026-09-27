---
name: TypeORM 1.0 behaviour changes
description: What changes when upgrading TypeORM 0.3 to 1.x — null/undefined where values throw, INNER JOINs for non-nullable relations, orphaned children deleted, select:false columns excluded, removed global APIs and driver package swaps.
priority: 62
activation:
  versions: { orm.typeorm: ">=1" }
  content:
    - "\\binvalidWhereValuesBehavior\\b|\\bnullable\\s*:\\s*false\\b|\\borphanedRowAction\\b|\\bselect\\s*:\\s*false\\b"
    - "\\bsoft(?:Delete|Remove)\\s*\\(|\\brelations\\s*:\\s*\\[|\\bselect\\s*:\\s*\\["
    - "\\b(?:getRepository|getConnection|getManager|createConnection|findByIds|getCustomRepository)\\s*\\(|@EntityRepository\\b"
    - "['\"](?:mysql|sqlite3)['\"]"
sources:
  - https://typeorm.io/docs/releases/1.0/release-notes/
  - https://typeorm.io/blog/typeorm-1-0/
  - https://typeorm.io/docs/data-source/null-and-undefined-handling/
---
- **Where values throw**: `invalidWhereValuesBehavior` now defaults to `throw` — code relying on `{ x: undefined }` being ignored (optional filters) now fails, and `null` needs `IsNull()`. Fix: build where objects without undefined keys.
- **INNER JOIN relations**: `ManyToOne`/owning `OneToOne` relations with `nullable: false` are joined with INNER JOIN — rows whose foreign key points to a missing row vanish from `find` results. Fix: repair orphan data or mark the relation nullable.
- **Orphans deleted**: removing children from a one-to-many collection with a non-nullable foreign key now deletes them on `save()` (0.3 failed with a constraint error). Fix: review partial collection saves.
- **select: false**: such columns are excluded from all read queries — password checks reading the hash get `undefined`. Fix: `addSelect()` or `select: { password: true }` where needed.
- **Removed APIs and drivers**: `getRepository()`, `getConnection()`, `createConnection()`, `findByIds`, string `relations`/`select` arrays and `@EntityRepository` are gone; only `mysql2` and `better-sqlite3` remain; Node ≥20. Fix: `DataSource` methods, `findBy({ id: In(ids) })`.
