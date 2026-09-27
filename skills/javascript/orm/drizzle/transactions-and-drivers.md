---
name: Transactions and driver setup
description: Drizzle transaction and connection pitfalls — db used inside tx callbacks, tx.rollback() swallowed by try/catch, neon-http without interactive transactions, prepared statements through transaction-mode poolers and clients created per request.
priority: 64
tags: [CWE-362, CWE-400]
activation:
  content:
    - "\\.transaction\\s*\\(|\\btx\\.rollback\\s*\\(|\\bTransactionRollbackError\\b|\\bdb\\.batch\\s*\\("
    - "drizzle-orm/(?:neon-http|neon-serverless|postgres-js|node-postgres|mysql2|d1|libsql|better-sqlite3|vercel-postgres|planetscale-serverless)"
    - "\\bpostgres\\s*\\(|\\bnew\\s+(?:Pool|Client)\\s*\\(|\\bprepare\\s*:\\s*(?:false|true)\\b|\\.prepare\\s*\\(\\s*['\"]|\\bdrizzle\\s*\\("
sources:
  - https://orm.drizzle.team/docs/transactions
  - https://orm.drizzle.team/docs/connect-neon
  - https://orm.drizzle.team/docs/connect-supabase
---
- **db inside tx**: queries on `db` (or on services holding it) inside `db.transaction(async (tx) => …)` run outside the transaction → partial commits on failure. Fix: pass `tx` down.
- **Swallowed rollback**: `tx.rollback()` throws `TransactionRollbackError`; catching it inside the callback (or wrapping it in `try/catch`) lets the callback finish normally, so the transaction commits. Fix: let it propagate.
- **neon-http has no transactions**: with `drizzle-orm/neon-http`, `db.transaction()` throws "No transactions support in neon-http driver". Fix: the WebSocket `neon-serverless` driver, or `db.batch([...])` for atomic batches.
- **Transaction-mode poolers**: postgres.js through PgBouncer or Supabase's transaction pooler needs `prepare: false`; named prepared statements (`.prepare('name')`) break across pooled connections. Fix: disable prepared statements for pooled URLs.
- **Client per request**: calling `postgres()`, `new Pool()` or `drizzle()` inside handlers opens a new pool per request → connection exhaustion, especially on serverless. Fix: module-level singleton, small `max` behind a pooler.
