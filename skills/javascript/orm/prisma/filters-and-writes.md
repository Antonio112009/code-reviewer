---
name: Filters, undefined values and bulk writes
description: Prisma Client filters that hit the wrong rows — undefined values silently dropped, OR/AND/NOT with undefined, findFirst without orderBy, P2025 on update/delete versus silent bulk counts, and case sensitivity that differs by database.
priority: 66
tags: [CWE-639, CWE-1284]
activation:
  content:
    - "\\.(?:findFirst\\w*|findMany|updateMany\\w*|deleteMany|update|delete|count)\\s*\\(\\s*\\{"
    - "\\bwhere\\s*:\\s*\\{|\\b(?:OR|AND|NOT)\\s*:\\s*\\["
    - "\\bstrictUndefinedChecks\\b|\\bPrisma\\.skip\\b|\\bP2025\\b|\\bmode\\s*:\\s*['\"]insensitive['\"]"
sources:
  - https://www.prisma.io/docs/orm/v7/prisma-client/special-fields-and-types/null-and-undefined
  - https://www.prisma.io/docs/orm/v7/reference/error-reference
  - https://www.prisma.io/docs/orm/prisma-client/queries/case-sensitivity
---
- **undefined removes filters**: `where: { id: input.id }` with `id` undefined drops the condition — `findFirst` returns another user's row, `updateMany`/`deleteMany` hit every row. Fix: validate inputs; enable `strictUndefinedChecks` (preview) and use `Prisma.skip` for intentional omissions.
- **Logical operators**: an `OR` whose conditions are all undefined matches nothing, while `AND`/`NOT` with undefined match everything — permission filters built from optional parameters invert. Fix: assemble conditions explicitly and assert they are non-empty.
- **findFirst ambiguity**: `findFirst` on non-unique fields without `orderBy` returns an arbitrary match (plan-dependent) → the wrong "latest" or "current" record. Fix: `orderBy` with unique filters, or `findUnique`.
- **Not-found semantics**: `update`/`delete` throw P2025 when nothing matches (a 500 unless mapped), while `updateMany`/`deleteMany` silently return `{ count: 0 }` — ownership-scoped bulk writes then "succeed" without effect. Fix: map P2025 to 404; check `count`.
- **Case sensitivity**: `equals`/`contains` are case-sensitive on PostgreSQL unless `mode: 'insensitive'` (PostgreSQL/MongoDB only), while MySQL collations usually ignore case → duplicate e-mails or failed lookups differ per database. Fix: normalise values before storing and querying.
