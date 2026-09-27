---
name: Filters, raw SQL and unscoped writes
description: Drizzle query defects — sql.raw and dynamic identifiers built from input, where(undefined) and and() of undefined conditions removing filters, update/delete without where, eq() with null, and sql<T> typings that are compile-time only.
priority: 68
tags: [CWE-89, CWE-639]
activation:
  content:
    - "\\bsql\\.(?:raw|identifier|join|empty|placeholder)\\s*\\(|\\bsql\\s*<|\\bsql\\s*`"
    - "\\.(?:where|having)\\s*\\(|\\b(?:and|or)\\s*\\("
    - "\\b(?:db|tx|trx)\\.(?:update|delete)\\s*\\("
    - "\\beq\\s*\\([^()\\n]{1,80},\\s*null\\s*\\)"
sources:
  - https://orm.drizzle.team/docs/sql
  - https://orm.drizzle.team/docs/guides/conditional-filters-in-query
  - https://orm.drizzle.team/docs/operators
  - https://orm.drizzle.team/docs/eslint-plugin
---
- **sql.raw**: `sql.raw(input)` or `sql.raw(\`… ${x}\`)` bypasses parameterisation → SQL injection; values interpolated in `sql\`…${v}\`` are safe but identifiers are not values. Fix: allowlist column/table names and use `sql.identifier()`.
- **Vanishing filters**: `.where(undefined)` removes the WHERE, and `and()`/`or()` skip undefined conditions — when every optional filter is undefined, queries list everything and updates/deletes hit every row. Fix: keep the scoping condition (tenant, owner, id) outside the optional list.
- **Unscoped writes**: `db.update(table).set(…)` or `db.delete(table)` without `.where()` affects every row. Fix: always scope; enable eslint-plugin-drizzle `enforce-update-with-where`/`enforce-delete-with-where`.
- **null comparisons**: `eq(col, null)` compares with a NULL parameter and never matches. Fix: `isNull()`/`isNotNull()`.
- **Types are compile-time**: `sql<number>\`count(*)\`` still returns a string on PostgreSQL, and `.$type<T>()` never validates data. Fix: `.mapWith(Number)` or the `count()` helper; runtime validation at the boundaries.
