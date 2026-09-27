---
name: pgx pool, rows and transactions
description: Sharing one pgx.Conn across goroutines, connections leaked by unscanned QueryRow or unclosed rows, ErrNoRows matching, transactions whose context does not roll back, and SQLSTATE handling.
priority: 64
tags: [CWE-404, CWE-362]
activation:
  content:
    - '\bpgxpool\.'
    - '\bpgx\.(?:Conn|Connect|CollectRows|CollectOneRow|RowTo\w{1,20}|ErrNoRows|BeginFunc|Tx|Rows)\b'
    - '\.(?:QueryRow|Query|Acquire|Release|Begin|BeginTx|Exec)\(\s*ctx\b'
    - '\bpgconn\.PgError\b'
sources:
  - https://pkg.go.dev/github.com/jackc/pgx/v5
  - https://pkg.go.dev/github.com/jackc/pgx/v5/pgxpool
  - https://github.com/jackc/pgx/blob/master/CHANGELOG.md
---
- **Shared pgx.Conn**: one `*pgx.Conn` used by concurrent handlers or goroutines → "conn busy" errors and corrupted protocol state; a Conn is not concurrency-safe. Fix: `pgxpool.Pool`, or one Conn per goroutine.
- **Leaked pool connections**: `pool.QueryRow(…)` whose `Row` is never `Scan`ned, `pool.Query` rows not closed on early return, or `Acquire` without `Release` → the pool (default MaxConns = max(4, NumCPU)) drains and requests hang. Fix: always Scan, `defer rows.Close()`, `pgx.CollectRows`.
- **ErrNoRows**: `QueryRow().Scan` and `CollectOneRow` return `pgx.ErrNoRows`; `errors.Is(err, sql.ErrNoRows)` matches it only since v5.7.0 and `==` against `sql.ErrNoRows` never does → not-found becomes 500. Fix: `errors.Is(err, pgx.ErrNoRows)`.
- **Tx ctx does not roll back**: unlike database/sql, the ctx given to `pool.Begin`/`BeginTx` only affects BEGIN; cancelling it later neither rolls back nor frees the connection. Fix: `defer tx.Rollback(ctx)` (no-op after Commit) or `pgx.BeginFunc`.
- **Rows.Err**: loops over `rows.Next()` must check `rows.Err()` afterwards (or use `CollectRows`) → otherwise query errors and cancellations look like short results.
- **Constraint errors**: detect duplicates/foreign-key failures via `errors.As(err, &pgErr)` with `*pgconn.PgError` and `pgErr.Code` (`23505`, `23503`), not message text. Fix: map codes to domain errors.
