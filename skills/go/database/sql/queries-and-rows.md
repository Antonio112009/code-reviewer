---
name: database/sql queries, rows and scanning
description: Unclosed rows and unchecked rows.Err, Query used for writes, ErrNoRows handling, NULL scanning, RawBytes aliasing, nested queries on a small pool and IN-list/placeholder mistakes.
priority: 64
tags: [CWE-404, CWE-89]
activation:
  content:
    - '\.(?:Query|QueryRow|QueryContext|QueryRowContext|Queryx|QueryRowx)\('
    - '\brows\.(?:Next|Scan|Close|Err)\('
    - '\bsql\.(?:Null\w{0,12}|RawBytes|ErrNoRows)\b'
    - '\bIN\s*\(\s*(?:\?|\$\d|%s)'
  examples:
    - 'rows, err := db.QueryContext(ctx, query)'
    - 'for rows.Next() {'
    - 'var name sql.NullString'
    - 'query := "SELECT * FROM users WHERE id IN (?, ?, ?)"'
sources:
  - https://pkg.go.dev/database/sql#Rows
  - https://go.dev/doc/database/querying
  - https://pkg.go.dev/database/sql#Null
  - https://pkg.go.dev/database/sql#RawBytes
---
- **Rows lifecycle**: `rows, err := db.Query(…)` without `defer rows.Close()` right after the error check, or returning mid-loop, holds a pooled connection → pool exhaustion; skipping `rows.Err()` after the loop accepts truncated results. Fix: Close + Err.
- **Query for writes**: `db.Query`/`QueryRow` for INSERT/UPDATE whose rows are never closed/scanned leaks the connection. Fix: `ExecContext`, or `QueryRow(...).Scan` for `RETURNING`.
- **No rows**: `QueryRow().Scan` returns `sql.ErrNoRows` (compare with `errors.Is`) while `Query` just yields nothing → not-found mapped to 500, or empty results mistaken for success.
- **NULL columns**: scanning NULL into `string`, `int64` or `time.Time` fails only when production data contains NULLs. Fix: `sql.Null[T]` (Go 1.22+), `sql.NullString`, pointers or `COALESCE`.
- **RawBytes aliasing**: `sql.RawBytes` is valid only until the next `Next`/`Scan`/`Close` → stored values get overwritten. Fix: scan into `string`/`[]byte` copies.
- **Nested queries**: running another query per row while iterating needs a second connection → deadlock with a small `SetMaxOpenConns`, N+1 load otherwise. Fix: read rows first, or one JOIN.
- **IN lists and placeholders**: a slice cannot bind to `IN (?)`; building the list with `Sprintf`/`strings.Join` → injection. Placeholders differ (`?` MySQL/SQLite, `$1` Postgres). Fix: generate one placeholder per value, or `= ANY($1)` on Postgres.
