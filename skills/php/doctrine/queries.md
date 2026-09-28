---
name: DQL and QueryBuilder
description: Doctrine query traps — DQL injection and unvalidated sort fields, where() replacing earlier conditions, limits with fetch-joined collections, single-result exceptions, bulk DQL bypassing the UnitOfWork, and hydrating huge results.
priority: 66
tags: [CWE-89, CWE-639, CWE-400]
activation:
  content:
    - '->(?:createQuery|createQueryBuilder)\s*\('
    - '->(?:andWhere|orWhere|setMaxResults|setFirstResult|getSingleResult|getOneOrNullResult|getSingleScalarResult|toIterable|addOrderBy)\s*\('
    - '\b(?:Offset|Cursor)?Paginator\b'
  examples:
    - '$qb = $em->createQueryBuilder()->andWhere(''u.active = :active'')->setParameter(''active'', true);'
    - '$paginator = new Paginator($qb->setMaxResults(20), fetchJoinCollection: true);'
sources:
  - https://www.doctrine-project.org/projects/doctrine-orm/en/current/reference/dql-doctrine-query-language.html
  - https://www.doctrine-project.org/projects/doctrine-orm/en/current/reference/query-builder.html
  - https://www.doctrine-project.org/projects/doctrine-orm/en/current/reference/batch-processing.html
  - https://github.com/doctrine/orm/blob/3.7.x/UPGRADE.md
---
- **DQL injection**: variables concatenated into `createQuery()` or `where("u.email = '$email'")`, and request values used as `orderBy()` fields or directions → injection into DQL and SQL. Fix: `setParameter()`, allowlist sort fields.
- **where() replaces**: a second `->where()` discards earlier conditions (tenant or owner filters) and `orWhere()` widens the whole predicate. Fix: `andWhere()`, group alternatives with `expr()->orX()`.
- **Limits with fetch joins**: `setMaxResults()`/`setFirstResult()` on a query that fetch-joins a collection limit SQL rows, not entities → short pages and truncated collections. Fix: `Paginator` (`OffsetPaginator` since 3.7) with `fetchJoinCollection`.
- **Single-result exceptions**: `getSingleResult()` throws on zero or several rows, and `getOneOrNullResult()` still throws `NonUniqueResultException` → 500s on unexpected duplicates. Fix: `setMaxResults(1)` or handle them.
- **Bulk DQL**: `UPDATE`/`DELETE` DQL skips lifecycle events, cascades and the identity map → loaded entities keep old values and may be flushed back. Fix: `clear()` afterwards.
- **Huge results**: `getResult()` hydrates every row into managed objects. Fix: `toIterable()` with periodic `clear()` (not with fetch-joined collections), or `getArrayResult()`/scalar queries.
