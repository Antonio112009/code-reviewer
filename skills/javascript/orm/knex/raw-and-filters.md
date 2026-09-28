---
name: Raw SQL, bindings and filters
description: Knex injection and filter-scope defects — interpolated raw/whereRaw/orderByRaw, object values in where on MySQL (< 2.4.0), empty where objects and whereNotIn([]) matching every row, merge() overwriting all columns and count()/first() result types.
priority: 66
tags: [CWE-89, CWE-639]
activation:
  content:
    - "\\b(?:knex|trx|db)\\.raw\\b|\\.(?:whereRaw|orWhereRaw|havingRaw|orderByRaw|joinRaw|groupByRaw)\\s*\\("
    - "\\.(?:whereNotIn|del)\\s*\\(|\\.where\\s*\\(\\s*(?:\\{\\s*\\.\\.\\.|req\\b|filters?\\b|query\\b|input\\b|params\\b|conditions\\b|criteria\\b)"
    - "\\.(?:onConflict|merge|count|first)\\s*\\("
  examples:
    - 'const rows = await knex.raw("SELECT * FROM users WHERE id = ?", [id]);'
    - 'const rows = await knex("users").where(filters).whereNotIn("id", excluded);'
    - 'await knex("users").insert(row).onConflict("id").merge();'
sources:
  - https://knexjs.org/guide/raw.html
  - https://knexjs.org/guide/query-builder.html
  - https://github.com/knex/knex/issues/5500
  - https://github.com/knex/knex/issues/2975
---
- **Interpolated raw SQL**: `knex.raw(\`… ${x}\`)`, `whereRaw('id = ' + id)` or `orderByRaw(sort)` → SQL injection. Fix: `?` value and `??` identifier bindings (`:name`/`:name:` named); allowlist sort columns and directions.
- **MySQL object values (< 2.4.0)**: `where({ token: req.body.token })` with an object or array value could compile to SQL that ignores the condition (CVE-2016-20018). Fix: upgrade; coerce inputs to primitives.
- **Empty filters**: `.where({})` from optional input is ignored and `whereNotIn('id', [])` compiles to `1 = 1` → `.del()`/`.update()` hit every row. Fix: assert a non-empty scoping condition before writes.
- **merge() overwrites**: `onConflict(key).merge()` without arguments overwrites every inserted column (`created_at`, ownership fields), and MySQL ignores the conflict target, using the primary key. Fix: `merge(['col1', 'col2'])`.
- **Result types**: `count()` returns strings for bigint results on PostgreSQL/MySQL, keyed differently per dialect; `.first()` resolves `undefined` when nothing matches. Fix: alias and `Number()` counts; handle `undefined`.
