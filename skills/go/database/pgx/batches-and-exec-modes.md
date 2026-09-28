---
name: pgx batches, exec modes and poolers
description: Unclosed batch results, the default statement cache behind PgBouncer, "cached plan must not change result type" after migrations, simple-protocol SQL injection fixed in v4.18.2/v5.5.4/v5.9.2, and CopyFrom atomicity.
priority: 62
tags: [CWE-89, CWE-404]
activation:
  content:
    - '\b(?:SendBatch|BatchResults|QueuedQuery)\b'
    - '\bpgx\.Batch\b'
    - '\bQueryExecMode\w{0,20}\b'
    - '\b(?:default_query_exec_mode|statement_cache_capacity|description_cache_capacity|prefer_simple_protocol)\b'
    - '[Pp]g[Bb]ouncer'
    - '\bCopyFrom\('
  examples:
    - 'br := pool.SendBatch(ctx, batch)'
    - 'batch := &pgx.Batch{}'
    - 'mode := pgx.QueryExecModeSimpleProtocol'
    - 'dsn := "postgres://user@host/db?default_query_exec_mode=exec"'
    - '// behind PgBouncer, prepared statements must be disabled'
    - 'n, err := conn.CopyFrom(ctx, pgx.Identifier{"logs"}, cols, rows)'
sources:
  - https://pkg.go.dev/github.com/jackc/pgx/v5#QueryExecMode
  - https://github.com/jackc/pgx/blob/master/CHANGELOG.md
  - https://github.com/advisories/GHSA-m7wr-2xf7-cm9p
  - https://github.com/jackc/pgx/issues/2360
---
- **Batch results**: results of `SendBatch` must be read in queue order and `br.Close()` called — errors often surface only on Close; returning early leaves the connection unusable/leaked. Fix: `defer br.Close()` and check its error.
- **PgBouncer**: the default `QueryExecModeCacheStatement` prepares statements per connection; behind PgBouncer transaction/statement pooling (< 1.21 or `max_prepared_statements=0`) → "prepared statement … already exists/does not exist". Fix: `default_query_exec_mode=exec` (or `simple_protocol`), or PgBouncer ≥ 1.21 with prepared statements enabled.
- **Stale cached plans**: cached `SELECT *` statements fail with "cached plan must not change result type" (SQLSTATE 0A000) after migrations add or drop columns, until connections recycle. Fix: explicit columns; reset the pool after DDL; retry the transaction.
- **Simple-protocol injection**: `QueryExecModeSimpleProtocol`/`prefer_simple_protocol` interpolate arguments client-side; pgx v4 < 4.18.2 (CVE-2024-27289, `-$1` line comments), v5 < 5.5.4 (CVE-2024-27304, >4 GB messages) and < 5.9.2 (GHSA-j88v-2chj-qfwx, dollar-quoted literals) allow SQL injection. Fix: upgrade; prefer the extended protocol.
- **CopyFrom**: column names must match the row values' order and types; one bad row aborts the whole copy and nothing is written. Fix: validate rows first; handle the returned error and count.
