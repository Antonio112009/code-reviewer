---
name: SQL Server
description: SQL Server / T-SQL defects from transaction scoping and XACT_ABORT, identity retrieval and triggers, NOLOCK, upsert races, nvarchar/varchar mismatches, datetime rounding and stale @@ROWCOUNT/@@ERROR.
category: database
priority: 58
tier: essential
tags:
  - CWE-362
  - CWE-667
  - CWE-704
activation:
  stack:
    - db.sqlserver
  languages:
    - sql
    - csharp
    - typescript
    - javascript
    - python
    - java
    - kotlin
    - scala
    - go
    - php
    - ruby
    - rust
    - shell
  files:
    - "**/*.sql"
  content:
    - (?:from\s+|require\(\s*)['"](?:mssql(?:/msnodesqlv8)?|tedious)['"]|drizzle-orm/(?:mssql-core|node-mssql)
    - \b(?:import|from)\s+(?:pyodbc|pymssql|aioodbc|mssql_python)\b|\bjdbc:sqlserver:|com\.microsoft\.sqlserver|\bSql(?:Connection|Command|DataReader|Parameter|BulkCopy|Transaction)\b|\b(?:Microsoft|System)\.Data\.SqlClient\b|\bUse(?:SqlServer|AzureSql)\b|\bTransactionScope\b|github\.com/(?:microsoft|denisenkom)/go-mssqldb|\bsqlsrv_\w+\(|\btiberius\b|\bsql\.(?:NVarChar|VarChar|Request|Transaction|ConnectionPool)\b
    - \b(?:NVARCHAR|nvarchar|UNIQUEIDENTIFIER|uniqueidentifier)\b|\bSCOPE_IDENTITY\(|@@(?:IDENTITY|ROWCOUNT|TRANCOUNT|ERROR)\b|\bWITH\s*\(\s*NOLOCK\s*\)|\bsp_executesql\b|\bXACT_ABORT\b|\bOUTPUT\s+(?:INSERTED|DELETED)\.|\bMERGE\s+(?:INTO\s+)?[\w\[\].]+\s+(?:AS\s+)?\w+\s+USING\b|^[ \t]*GO[ \t]*$|\bTOP\s*\(\s*[@\d]|\bBEGIN\s+TRAN(?:SACTION)?\b
    - \b(?:SELECT|UPDATE|DELETE)\b[\s\S]{0,200}?\b(?:FROM|SET|WHERE)\b|\bINSERT\s+INTO\b|\b(?:ALTER|CREATE)\s+(?:TABLE|(?:UNIQUE\s+)?(?:(?:NON)?CLUSTERED\s+)?INDEX|PROCEDURE|PROC|TRIGGER)\b
    - "['\"`]\\s*(?:select\\s+(?:\\*|top\\b|distinct\\b|count\\(|[\\w.\\[\\]]+\\s*(?:,|\\bfrom\\b|\\bas\\b))|update\\s+[\\w.\\[\\]]+\\s+set\\b|delete\\s+from\\b|insert\\s+into\\b|merge\\s+(?:into\\s+)?[\\w.\\[\\]]+)"
---
- **Transaction scope**: node `mssql` `pool.request()` inside a transaction runs on another connection → non-atomic writes, blocking on its own locks; .NET `new TransactionScope()` defaults to Serializable → range locks, deadlocks. Fix: `transaction.request()`, explicit `ReadCommitted`.
- **XACT_ABORT off**: by default many errors abort only the statement, and client timeouts leave the transaction open on the pooled connection → partial commits, held locks. Fix: `SET XACT_ABORT ON`, `TRY…CATCH` with rollback.
- **Identity and triggers**: `@@IDENTITY` returns ids inserted by triggers and `IDENT_CURRENT` other sessions' → wrong ids; `OUTPUT` without `INTO` fails on tables with triggers (EF Core 7+ needs `HasTrigger()`). Fix: `SCOPE_IDENTITY()`, `OUTPUT … INTO`.
- **Single-row triggers**: `SELECT @id = id FROM inserted` handles one arbitrary row of a multi-row statement → missed audits and side effects. Fix: set-based logic joining `inserted`/`deleted`.
- **NOLOCK**: `WITH (NOLOCK)`/`READ UNCOMMITTED` reads uncommitted rows and can return rows twice or skip them during page splits → wrong totals. Fix: `READ_COMMITTED_SNAPSHOT`.
- **Upsert races**: `IF EXISTS … UPDATE ELSE INSERT` or `MERGE` without `WITH (UPDLOCK, HOLDLOCK)` → duplicate-key errors or lost writes under concurrency. Fix: those hints inside the transaction.
- **N/varchar mismatch**: `nvarchar` parameters (JDBC default, `AddWithValue`, untyped `mssql` inputs) against `varchar` columns convert the column → index scans; `varchar` columns or literals without `N'…'` store non-Latin text as `?`. Fix: explicit types.
- **datetime rounding**: `datetime` rounds to 1/300 s, so `'…23:59:59.999'` becomes next midnight → end-of-day ranges include next-day rows. Fix: `datetime2`, half-open ranges.
- **Stale globals**: `@@ROWCOUNT`/`@@ERROR` describe only the previous statement; read after an `IF`, `SET` or `PRINT` they are reset → wrong "not found" and error handling. Fix: capture both in one `SELECT` right after the DML.
