---
name: Find options and where conditions
description: TypeORM find*/findOneBy pitfalls — undefined or null where values dropped by default in 0.3.x (first row or whole table returned), null needing IsNull(), primitive values under relation keys producing no WHERE, and collections loaded without limits.
priority: 66
tags: [CWE-639, CWE-1284]
activation:
  content:
    - "\\.(?:findOne|findOneBy|findOneOrFail|findOneByOrFail|findBy|findAndCount|findAndCountBy|countBy|existsBy|exists|softDelete|restore)\\s*\\("
    - "\\bwhere\\s*:\\s*[\\[{]|\\binvalidWhereValuesBehavior\\b"
    - "\\b(?:IsNull|Not|In|Raw|Like|ILike|MoreThan|LessThan|Between)\\s*\\("
    - "\\brelations\\s*:|\\beager\\s*:\\s*true\\b"
  examples:
    - 'const user = await userRepo.findOneBy({ id: input.id })'
    - 'const users = await userRepo.find({ where: { tenantId: undefined } })'
    - 'const rows = await userRepo.findBy({ deletedAt: IsNull() })'
    - 'const posts = await postRepo.find({ relations: { comments: true } })'
sources:
  - https://typeorm.io/docs/data-source/null-and-undefined-handling/
  - https://github.com/typeorm/typeorm/issues/12712
  - https://typeorm.io/docs/releases/1.0/release-notes/
---
- **undefined drops the filter (0.3.x)**: `findOneBy({ id: undefined })` returns the first row and `findBy({ tenantId: undefined })` the whole table — 0.3 ignores undefined where values by default. Fix: validate ids; `invalidWhereValuesBehavior` `'throw'` (1.0 default).
- **null is not IS NULL**: `{ deletedAt: null }` is ignored in 0.3 (all rows) and throws in 1.0. Fix: `IsNull()`/`Not(IsNull())`, or opt into `null: 'sql-null'`.
- **Primitive under a relation key**: `findBy({ author: userId })` — a plain id under a relation property — has produced no WHERE at all (issue #12712) → other users' rows. Fix: `{ author: { id: userId } }`.
- **QueryBuilder isn't covered**: `invalidWhereValuesBehavior` protects `find*` and repository methods, not strings passed to `.where()`. Fix: validate before building queries.
- **Unbounded relations**: `relations: { orders: true }` or `eager: true` loads entire collections for every parent (memory spikes, slow list endpoints). Fix: explicit selects, separate paged queries, no eager on large collections.
