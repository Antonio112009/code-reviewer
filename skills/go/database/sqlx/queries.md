---
name: sqlx queries and struct mapping
description: sqlx Get returning ErrNoRows, SELECT * breaking on new columns (missing destination name) or hidden by Unsafe, Select loading everything, In/Rebind requirements and Must* helpers that panic.
priority: 58
tags: [CWE-400, CWE-89]
activation:
  content:
    - '\.(?:Get|Select)(?:Context)?\(\s*(?:ctx\s*,\s*)?&'
    - '\bsqlx\.(?:In|Named|MustConnect|Connect|Select|Get)\b'
    - '\.(?:NamedExec|NamedQuery|MustExec|MustBegin|Rebind|Unsafe|StructScan|Queryx)\w{0,7}\('
  examples:
    - 'err := db.GetContext(ctx, &user, query, id)'
    - 'query, args, err := sqlx.In("SELECT * FROM t WHERE id IN (?)", ids)'
    - 'err = tx.NamedExec(query, params)'
sources:
  - https://jmoiron.github.io/sqlx/
  - https://pkg.go.dev/github.com/jmoiron/sqlx
---
- **Get without rows**: `db.Get(&v, …)` returns `sql.ErrNoRows` when nothing matches → not-found turned into 500 unless checked with `errors.Is`; `Select` returns an empty slice and nil.
- **SELECT * with structs**: columns without a matching `db` tag fail with "missing destination name" → a migration adding a column breaks every `SELECT *` before new code ships; `db.Unsafe()` hides such mismatches. Fix: explicit column lists.
- **Select loads everything**: `Select` reads the whole result set into memory → unbounded tables cause OOM. Fix: `LIMIT`/pagination, or `Queryx` + `StructScan` streaming.
- **In queries**: `sqlx.In` returns `?` bindvars that must go through `db.Rebind` for PostgreSQL; an empty slice returns an error to handle. Fix: never build IN lists with `Sprintf`.
- **Must* helpers**: `MustExec`, `MustBegin`, `MustConnect` panic on any error → a transient DB error crashes workers or goroutines without recovery. Fix: error-returning variants outside `main`.
