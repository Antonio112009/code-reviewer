---
name: QueryBuilder and raw SQL
description: TypeORM QueryBuilder injection and correctness — interpolated where/orderBy/select strings, parameter names silently overwritten across the query, limit/offset with joins and raw results returning strings.
priority: 68
tags: [CWE-89]
activation:
  content:
    - "\\bcreateQueryBuilder\\s*\\(|\\.(?:andWhere|orWhere|orderBy|addOrderBy|addSelect|setParameters?|getRawMany|getRawOne|leftJoinAndSelect|innerJoinAndSelect)\\b"
    - "\\b(?:manager|dataSource|queryRunner|connection)\\.query\\s*\\("
    - "\\.(?:where|having)\\s*\\(\\s*`"
  examples:
    - 'const qb = userRepo.createQueryBuilder("user").andWhere("user.id = :id", { id })'
    - 'const rows = await manager.query("SELECT * FROM users WHERE id = " + id)'
    - 'qb.where(`user.id = ${id}`)'
sources:
  - https://typeorm.io/docs/query-builder/select-query-builder/
  - https://typeorm.io/docs/releases/1.0/release-notes/
---
- **Interpolated fragments**: `.where(\`user.id = ${id}\`)`, `.orderBy(req.query.sort)`, `.addSelect(field)`, join conditions built with template literals and `manager.query(\`… ${x}\`)` → SQL injection. Fix: `:param` bindings; allowlist identifiers and sort directions.
- **Parameter collisions**: parameter names are global to the query — `andWhere('a.x = :v', { v: 1 })` then `andWhere('b.y = :v', { v: 2 })`, or `:id` reused in a subquery, silently use the last value. Fix: unique names.
- **limit/offset with joins**: `.limit()`/`.offset()` apply to joined rows, so `leftJoinAndSelect` + `limit(10)` returns fewer entities and truncated collections. Fix: `take()`/`skip()`.
- **Raw results are strings**: `getRawMany()`/`manager.query()` return driver values — `bigint`, `numeric` and `COUNT(*)` as strings on PostgreSQL/MySQL, keys aliased like `user_id` — so `===` and sums misbehave. Fix: cast or convert explicitly.
