---
name: Selected fields, pagination and N+1
description: Prisma reads that leak or overload — full rows and relations returned to clients, client-controlled select/include/orderBy, unbounded findMany and N+1 patterns that Prisma's findUnique batching does not cover.
priority: 64
tags: [CWE-200, CWE-400]
activation:
  content:
    - "\\.findMany\\s*\\(|\\.findFirst\\w*\\s*\\("
    - "\\b(?:select|include|omit|orderBy)\\s*:\\s*(?:\\{|req\\b|input\\b|query\\b|args\\b|body\\b|params\\b)"
    - "\\b(?:take|skip|cursor)\\s*:|\\brelationLoadStrategy\\b|\\bomit\\s*:"
sources:
  - https://www.prisma.io/docs/orm/prisma-client/queries/query-optimization-performance
  - https://github.com/prisma/prisma/releases/tag/6.2.0
  - https://www.prisma.io/docs/orm/prisma-client/queries/excluding-fields
---
- **Full rows out**: returning `findUnique`/`findMany` results directly sends every scalar — password hashes, tokens, internal flags — and `include` adds whole related records. Fix: `select` response fields, or `omit` (GA in 6.2, also global on `PrismaClient`).
- **Client-chosen shape**: passing `select`, `include` or `orderBy` objects from request input lets callers pull hidden fields and relations (`include: { sessions: true }`) or sort by secret columns. Fix: map allowed options server-side.
- **Unbounded reads**: `findMany()` without `take`, or `take` taken from input without a cap, loads whole tables; large `skip` offsets degrade. Fix: default and maximum `take`; cursor pagination on a unique, sorted field.
- **N+1**: `findFirst`/`findMany` per parent inside loops or GraphQL field resolvers issue one query each — Prisma's dataloader batches only `findUnique` calls in the same tick with the same shape. Fix: `include`, `in` filters, fluent `findUnique().relation()` or `relationLoadStrategy: 'join'`.
