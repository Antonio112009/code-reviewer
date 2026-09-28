---
name: sqlx transactions and pools
description: Statements escaping a transaction via &pool, silent rollback on drop, cancelled begin() leaving pooled connections inside a transaction (<0.9), pool defaults and pools or connections held per request.
priority: 64
tags: [CWE-362, CWE-400, CWE-667]
activation:
  content:
    - '\.begin\(\)|\bTransaction<|\.commit\(\)|\.rollback\(\)'
    - '\b(?:Pg|MySql|Sqlite)?PoolOptions\b|\bPool::connect|\bconnect_lazy\b'
    - '\.acquire\(\)|\bPoolConnection\b'
    - '&mut\s+\*\s*\w*tx\b'
  examples:
    - 'let mut tx = pool.begin().await?;'
    - 'let pool = PgPoolOptions::new().max_connections(10).connect(&url).await?;'
    - 'let mut conn: PoolConnection<Postgres> = pool.acquire().await?;'
    - 'sqlx::query("UPDATE users SET active = true").execute(&mut *tx).await?;'
sources:
  - https://docs.rs/sqlx/latest/sqlx/struct.Transaction.html
  - https://docs.rs/sqlx/latest/sqlx/pool/struct.PoolOptions.html
  - https://github.com/launchbadge/sqlx/pull/3980
---
- **Statements outside the transaction**: inside a `begin()` block, passing `&pool` or `&state.db` instead of `&mut *tx` runs that statement on another connection, outside the transaction (it can even block on rows `tx` locked). Fix: pass `&mut *tx` everywhere.
- **Missing commit**: a `Transaction` dropped without `commit()` (early `return`, `?`, forgotten call) rolls back silently. Fix: commit on every success path; tests asserting persistence.
- **Cancelled `begin()` (<0.9)**: a timeout or client disconnect while `BEGIN` runs could return the connection to the pool still inside a transaction → later writes on it never commit (fixed in 0.9.0). Fix: upgrade; don't cancel around `begin()`.
- **Pool defaults**: `max_connections` 10 and `acquire_timeout` 30 s are rarely right — too small for load, or above the DB limit once multiplied by replicas. Fix: size explicitly per deployment.
- **Pool per request, long holds**: `PgPool::connect` inside handlers, or holding a `PoolConnection`/`Transaction` across slow network calls → exhaustion and 30 s stalls. Fix: one pool in app state; no external I/O inside transactions.
