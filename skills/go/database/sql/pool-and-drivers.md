---
name: database/sql pool settings and driver quirks
description: sql.Open per request, default pool limits, leaked prepared statements, MySQL DSN pitfalls (parseTime, loc, RowsAffected), LastInsertId on PostgreSQL and SQLite in-memory/locking behaviour.
priority: 60
tags: [CWE-400, CWE-404]
activation:
  content:
    - '\bsql\.Open\('
    - '\bsqlx\.(?:Open|Connect|MustConnect)\('
    - '\.Set(?:MaxOpenConns|MaxIdleConns|ConnMaxLifetime|ConnMaxIdleTime)\('
    - '\.Prepare(?:Context|x|Named)?\('
    - '\b(?:LastInsertId|RowsAffected)\(\)'
    - '\b(?:parseTime|clientFoundRows|_busy_timeout|busy_timeout)\b|:memory:'
sources:
  - https://pkg.go.dev/database/sql#DB
  - https://go.dev/doc/database/manage-connections
  - https://github.com/go-sql-driver/mysql#parameters
  - https://github.com/mattn/go-sqlite3#faq
---
- **Open per request**: `sql.Open`/`sqlx.Connect` inside handlers or per job creates a new pool each call; `db.Close()` in request code breaks concurrent users → connection storms. Fix: open once at startup; `PingContext` to verify (Open does not connect).
- **Pool defaults**: `MaxOpenConns` is unlimited (can exhaust the server's `max_connections`), `MaxIdleConns` is 2 (constant reconnects under load), no `ConnMaxLifetime` (stale connections after failover or behind load balancers). Fix: set all three explicitly.
- **Prepared statements**: `db.Prepare` per call without `Close` leaks server-side statements; on a pool each statement is re-prepared per connection and fails behind PgBouncer transaction pooling. Fix: prepare once and close, or don't prepare.
- **MySQL DSN**: go-sql-driver/mysql without `parseTime=true` cannot scan DATETIME into `time.Time`; `loc` defaults to UTC; `RowsAffected` counts changed rows only (0 when values are unchanged) unless `clientFoundRows=true` → false "not found".
- **LastInsertId on Postgres**: lib/pq and pgx stdlib do not support it (error or 0). Fix: `INSERT … RETURNING id` with `QueryRow`.
- **SQLite**: `:memory:` DSNs give every pooled connection its own empty database (tables "disappear"); concurrent writers get `database is locked`. Fix: `SetMaxOpenConns(1)` or shared cache, WAL plus busy timeout.
