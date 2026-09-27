---
name: database/sql transactions and session state
description: Transactions without a rollback path, db calls made outside the Tx, ignored Commit errors, context cancellation rolling back, raw BEGIN/SET on a pool and concurrent use of one Tx.
priority: 64
tags: [CWE-667, CWE-662]
activation:
  content:
    - '\.(?:Begin|BeginTx|Beginx|BeginTxx|MustBegin|Commit|Rollback)\('
    - '\bsql\.(?:Tx|TxOptions|Level\w{4,20})\b'
    - '"\s*(?:BEGIN|COMMIT|ROLLBACK|SET|START TRANSACTION)\b'
sources:
  - https://go.dev/doc/database/execute-transactions
  - https://pkg.go.dev/database/sql#DB.BeginTx
  - https://go.dev/doc/database/manage-connections
---
- **No rollback path**: `tx, err := db.BeginTx(…)` without `defer tx.Rollback()` → any early return or panic leaves the transaction open, holding a pooled connection and row locks. Fix: defer Rollback right after Begin (no-op after Commit).
- **db inside the tx**: `db.Exec/Query` (or repositories holding `*sql.DB`) called while a `Tx` is open run outside it → partial writes; with a small pool it deadlocks waiting for a connection. Fix: pass the `*sql.Tx`/a querier interface down.
- **Commit unchecked**: `tx.Commit()` without checking the error, or `defer tx.Commit()` → failed commits (serialization, deferred constraints) reported as success. Fix: return the Commit error.
- **Context cancels the tx**: if the ctx passed to `BeginTx` is cancelled, database/sql rolls back and `Commit` fails → request-scoped ctx on work that must finish rolls back silently. Fix: choose the ctx deliberately; handle the Commit error.
- **Raw BEGIN/SET on a pool**: `db.Exec("BEGIN")`, `"COMMIT"` or `"SET search_path/time_zone/role …"` on `*sql.DB` hit arbitrary pooled connections → no atomicity, settings leak to other requests. Fix: `BeginTx`; `db.Conn(ctx)` or DSN parameters for session state.
- **One Tx, many goroutines**: a `Tx` is bound to one connection; concurrent queries on it (or a new query while rows are open) fail with "conn busy"/"busy buffer" errors. Fix: serialise work within the transaction.
