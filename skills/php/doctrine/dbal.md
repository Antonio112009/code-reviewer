---
name: Doctrine DBAL 3/4
description: DBAL traps — delete()/update() with empty criteria touching every row (DBAL 4), interpolated SQL and identifiers, array parameters, DBAL 4 type changes (BIGINT as int, strict DateTime types, removed array/object), savepoint-based nesting and false fetch results.
priority: 64
tags: [CWE-89, CWE-1286, CWE-704]
activation:
  content:
    - '->(?:executeQuery|executeStatement|fetchAssociative|fetchAllAssociative|fetchOne|fetchFirstColumn|iterateAssociative|quoteIdentifier|quoteSingleIdentifier)\s*\('
    - '\b(?:ArrayParameterType|ParameterType)::|\bDriverManager::getConnection\s*\(|\bTypes::(?:BIGINT|DATETIME_MUTABLE|DATE_MUTABLE)\b'
    - '->(?:delete|update|insert)\s*\(\s*[''"]\w+[''"]\s*,'
  examples:
    - '$rows = $conn->fetchAllAssociative(''SELECT * FROM users WHERE team_id = ?'', [$teamId]);'
    - '$conn->executeQuery(''SELECT id FROM users WHERE id IN (?)'', [$ids], [ArrayParameterType::INTEGER]);'
    - '$conn->delete(''users'', [''id'' => $id]);'
sources:
  - https://github.com/doctrine/dbal/blob/4.4.x/UPGRADE.md
  - https://www.doctrine-project.org/projects/doctrine-dbal/en/current/reference/data-retrieval-and-manipulation.html
  - https://www.doctrine-project.org/projects/doctrine-dbal/en/current/reference/transactions.html
---
- **Empty criteria (DBAL 4)**: `$conn->delete('users', $criteria)` and `update($table, $data, $criteria)` no longer reject an empty criteria array → a filter that ends up empty deletes or updates every row. Fix: assert criteria are non-empty.
- **Interpolated SQL**: values or identifiers concatenated into `executeQuery()`/`executeStatement()` → injection. Fix: `?`/named parameters; allowlist identifiers (identifiers cannot be bound).
- **Array parameters**: `IN (?)` with an array needs `ArrayParameterType::INTEGER`/`STRING` (DBAL 4 removed `Connection::PARAM_*_ARRAY`) → otherwise binding the array fails.
- **Type changes (DBAL 4)**: BIGINT now hydrates as `int` (was string) → `===` against strings fails; `datetime`/`date` types reject `DateTimeImmutable` (use `*_immutable`); the serialize-based `array`/`object` types are removed.
- **Nested transactions (DBAL 4)**: nested `beginTransaction()` always uses savepoints, so an inner `rollBack()` undoes only the savepoint and the outer `commit()` still succeeds → partial work committed where DBAL 3 aborted the whole transaction.
- **False results**: `fetchAssociative()`/`fetchOne()` return `false` for no row → reading keys yields null with warnings; affected-row counts can be `int|string`.
