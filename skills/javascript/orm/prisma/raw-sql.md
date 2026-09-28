---
name: Raw SQL with Prisma
description: Prisma raw-query injection and correctness — $queryRawUnsafe/$executeRawUnsafe and Prisma.raw with input, identifiers inside tagged templates, placeholders inside quotes, IN lists and BigInt/Decimal results.
priority: 70
tags: [CWE-89]
activation:
  content:
    - "\\$(?:queryRaw|executeRaw)(?:Unsafe|Typed)?\\b"
    - "\\bPrisma\\.(?:sql|raw|join|empty)\\b"
  examples:
    - 'const rows = await prisma.$queryRawUnsafe(`SELECT * FROM users WHERE id = ${id}`)'
    - 'const clause = Prisma.sql`AND status = ${status}`'
sources:
  - https://www.prisma.io/docs/orm/v7/prisma-client/using-raw-sql/raw-queries
  - https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries
---
- **Unsafe variants**: `$queryRawUnsafe`/`$executeRawUnsafe` with template literals or `+` concatenation of input → SQL injection; they are safe only with `$1` placeholders and values passed as extra arguments. Fix: tagged `$queryRaw\`… ${value}\``.
- **Prisma.raw**: `Prisma.raw(input)` or `Prisma.sql([str])` inject raw text — typically for dynamic `ORDER BY`, column or table names. Fix: map input to an allowlist of constant fragments.
- **Identifiers are values**: `${column}`/`${table}` inside tagged templates become bind parameters → syntax errors or comparisons against a string, prompting unsafe rewrites. Fix: allowlisted `Prisma.raw`/`Prisma.sql` fragments.
- **Quoted placeholders**: `LIKE '%${q}%'` or `'${id}'` in a tagged template puts the placeholder inside a string literal → no match or a parameter error. Fix: `LIKE ${'%' + q + '%'}`, escaping `%` and `_` in `q`.
- **IN lists**: `IN (${ids})` binds the array as a single value; `Prisma.join([])` throws on an empty list. Fix: `IN (${Prisma.join(ids)})` behind an empty-list guard.
- **Result types**: raw rows use database column names (no `@map`), `bigint`/`COUNT(*)` come back as `BigInt` (`JSON.stringify` throws) and `numeric` as `Decimal`. Fix: cast in SQL (`::int`) or convert before responding.
