---
name: SQL
description: SQL correctness defects in queries and migrations, such as NULL semantics, runaway writes, AND/OR precedence, undone outer joins, join fan-out, subquery column capture, nondeterministic LIMIT and grouping, integer division, implicit casts and fragile generated SQL.
category: language
priority: 55
tier: essential
tags:
  - CWE-697
  - CWE-682
  - CWE-783
  - CWE-1024
activation:
  files:
    - "**/*.{sql,psql,pgsql,ddl,hql}"
  content:
    - \bSELECT\b[\s\S]{1,400}?\bFROM\b
    - \b(?:UPDATE\s+[\w."`\[\]]+\s+SET|DELETE\s+FROM|INSERT\s+INTO|MERGE\s+INTO)\b
    - \b(?:LEFT|RIGHT|FULL|INNER|CROSS)\s+(?:OUTER\s+)?JOIN\b
    - "[\"'`]\\s*(?:select\\s+(?:\\*|distinct\\b|[\\w.\"]+(?:\\s*[,(]|\\s+(?:from|as)\\b))|update\\s+[\\w.\"`]+\\s+set\\b|delete\\s+from\\b|insert\\s+into\\b)"
---
- **NULL comparisons**: `= NULL` never matches; `col <> 'x'` drops NULL rows; `NOT IN` a subquery containing a NULL returns nothing → missing rows. Fix: `IS NULL`, `IS DISTINCT FROM`, `NOT EXISTS`.
- **NULL propagation**: `SUM` of no rows is NULL; a NULL operand makes `+` or `||` NULL; `COUNT(*)` over a `LEFT JOIN` counts childless rows as 1 → blank totals, wrong counts. Fix: `COALESCE`, `COUNT(child.id)`.
- **Runaway writes**: `UPDATE`/`DELETE` without `WHERE`, with a filter that can vanish, or Postgres `UPDATE … FROM` lacking the join predicate → every row changed. Fix: check affected row counts.
- **Precedence**: `a OR b AND tenant_id = ?` means `a OR (b AND …)` → tenant or soft-delete filters skipped. Fix: parenthesize.
- **Outer join undone**: a `WHERE` condition on a `LEFT JOIN`ed table's column → unmatched rows dropped. Fix: move it into `ON`.
- **Join fan-out**: joining two one-to-many tables, then `SUM`/`COUNT` → multiplied totals, often masked by `DISTINCT`. Fix: aggregate children before joining.
- **Column capture**: a column missing from the subquery's table binds to the outer query (`id IN (SELECT id FROM audit)`) → always true, every row deleted. Fix: qualify columns.
- **Nondeterminism**: `LIMIT`/`OFFSET`/`TOP` or `DISTINCT ON` without `ORDER BY` on a unique key; columns outside `GROUP BY` (MySQL, SQLite) → arbitrary rows, unstable pages. Fix: unique tiebreaker.
- **Type traps**: `int / int` truncates (PostgreSQL, SQL Server, SQLite); text compared with numbers (MySQL `'abc' = 0` is true); timestamps `BETWEEN` dates lose the last day → wrong results. Fix: `* 1.0`, matching types, half-open ranges.
- **Generated SQL**: `IN ()` from an empty list, input in `LIKE` without escaping `%`/`_`, `INSERT … SELECT *` without a column list → syntax errors, overmatching, shifted columns. Fix: guard empty lists, `ESCAPE`, name columns.
