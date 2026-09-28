---
name: MySQL / MariaDB
description: MySQL and MariaDB defects from pooled transactions, placeholder object expansion, 3-byte utf8 and lenient collations, upsert/REPLACE/IGNORE semantics, partial rollbacks, gap-lock deadlocks, auto-committing DDL and time-zone shifts.
category: database
priority: 60
tier: essential
tags:
  - CWE-89
  - CWE-704
  - CWE-362
  - CWE-1289
  - OWASP-A05
activation:
  stack:
    - db.mysql
  languages:
    - sql
    - typescript
    - javascript
    - python
    - go
    - java
    - kotlin
    - scala
    - csharp
    - ruby
    - php
    - rust
    - elixir
    - shell
  files:
    - "**/*.sql"
  content:
    - (?:from\s+|require\(\s*)['"](?:mysql2?(?:/promise)?|mariadb|@planetscale/database|serverless-mysql)['"]|drizzle-orm/(?:mysql-core|mysql2|planetscale-serverless|tidb-serverless)
    - \b(?:import|from)\s+(?:pymysql|MySQLdb|mysql\.connector|aiomysql|asyncmy|mariadb)\b|github\.com/go-sql-driver/mysql|\bjdbc:(?:mysql|mariadb):|\bMySqlConnector\b|\bMySql\.Data\b|\bUseMySql\b|\bPomelo\.|\bmysqli?_\w+\(|\bnew\s+mysqli\b|\bPDO\(\s*['"]mysql:|\bMysql2::Client\b|\bTrilogy\b|\bMyXQL\b|sqlx::mysql|\bMySqlPool\b
    - \bAUTO_INCREMENT\b|\bENGINE\s*=\s*InnoDB\b|\b(?:ON\s+DUPLICATE\s+KEY|on\s+duplicate\s+key)\b|\butf8mb[34]\b|\b(?:CHARSET|charset|CHARACTER[ \t]+SET)[ \t]*(?:[=:][ \t]*)?['"]?utf8\b|\bCOLLATE\b|\b(?:INSERT|UPDATE)\s+IGNORE\b|\bREPLACE\s+INTO\b|\bLAST_INSERT_ID\(|\binsertId\b|\bALGORITHM\s*=\s*(?:INSTANT|INPLACE|COPY)\b|\b(?:multipleStatements|stringifyObjects)\b|['"`]START\s+TRANSACTION\b
    - \b(?:SELECT|UPDATE|DELETE)\b[\s\S]{0,200}?\b(?:FROM|SET|WHERE)\b|\bINSERT\s+INTO\b|\b(?:ALTER|CREATE)\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\b|['"`](?:BEGIN|COMMIT|ROLLBACK)\b
    - "['\"`]\\s*(?:select\\s+(?:\\*|distinct\\b|count\\(|[\\w.`]+\\s*(?:,|\\bfrom\\b|\\bas\\b))|update\\s+[\\w.`]+\\s+set\\b|delete\\s+from\\b|insert\\s+(?:ignore\\s+)?into\\b|replace\\s+into\\b)"
  examples:
    - 'import mysql from "mysql2/promise";'
    - 'import pymysql'
    - 'CREATE TABLE t (id INT AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB;'
    - 'const rows = await conn.query("select * from users where id = ?", [id]);'
---
- **Pooled transactions**: `START TRANSACTION` via mysql2 `pool.query()` (or pool calls after `getConnection()`) hits other connections → no atomicity; unreleased connections exhaust the pool. Fix: one connection per transaction, `release()` in `finally`.
- **Placeholder expansion**: mysql/mysql2 `query()` expands objects to `` `key` = value `` (`password = ?` with `{"password":1}` is always true) → auth bypass; `multipleStatements: true` allows stacked injection. Fix: type-check inputs, `stringifyObjects: true`.
- **3-byte utf8**: `utf8`/`utf8mb3` schemas or connections (the mysqljs default) reject or `?`-mangle emoji → lost text. Fix: `utf8mb4` everywhere.
- **Lenient collations**: `_ci`/`_ai` collations make `=` and `UNIQUE` ignore case and accents, PAD SPACE ones trailing spaces → colliding tokens and usernames. Fix: `_bin` or `VARBINARY` for secrets.
- **Upsert variants**: `ON DUPLICATE KEY UPDATE` fires on any unique key (its `insertId` is meaningless when it updates); `REPLACE` deletes and reinserts → cascades, new ids; `INSERT IGNORE` hides truncation/FK errors. Fix: explicit keys.
- **Partial rollback**: lock wait timeout 1205 undoes only the statement, so catch-and-commit keeps half a transaction; deadlock 1213 undoes everything and later statements autocommit → partial writes. Fix: roll back, retry the whole transaction.
- **Gap-lock deadlocks**: under `REPEATABLE READ`, `SELECT … FOR UPDATE` on a missing row then `INSERT` (get-or-create), or locking unindexed predicates → deadlocks, range locks. Fix: unique index plus upsert, or `READ COMMITTED`.
- **DDL auto-commits**: DDL commits implicitly, so a failed multi-statement migration stays half-applied and earlier DML is committed → reruns fail. Fix: one DDL per migration, idempotent steps.
- **Time zones**: `TIMESTAMP` converts via the session `time_zone` and ends in 2038; mysql2's default `timezone: 'local'` → `DATETIME` values shift between hosts. Fix: UTC session, driver `timezone: 'Z'`.
