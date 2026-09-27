---
name: Transactions and concurrency
description: Prisma transaction defects — queries on the global client inside interactive transactions, the default 2 s/5 s maxWait and timeout, side effects inside transactions, $transaction arrays with non-Prisma promises, lost updates and upsert races.
priority: 68
tags: [CWE-362, CWE-667]
activation:
  content:
    - "\\$transaction\\s*\\("
    - "\\bisolationLevel\\b|\\bmaxWait\\b|\\bTransactionIsolationLevel\\b"
    - "\\.upsert\\s*\\(|\\bP20(?:02|25|28|34)\\b|\\b(?:increment|decrement)\\s*:"
sources:
  - https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions
  - https://www.prisma.io/docs/orm/v7/reference/error-reference
  - https://www.prisma.io/docs/orm/v7/reference/prisma-client-reference
---
- **Escaping the transaction**: inside `$transaction(async (tx) => …)`, calls on `prisma` or injected services instead of `tx` use other connections — they commit immediately, survive rollback and can deadlock on rows `tx` locked. Fix: pass `tx` down.
- **Timeouts**: interactive transactions default to `maxWait` 2 s and `timeout` 5 s — larger loops or slow queries fail midway ("Transaction already closed"). Fix: less work per transaction, or explicit `timeout`; never wait on users or networks inside.
- **Side effects**: e-mails, queue publishes, HTTP calls or file writes inside the callback happen even when it later rolls back. Fix: run them after commit (outbox).
- **Array form**: `$transaction([a, b])` accepts only un-awaited Prisma query promises — other promises throw, and an `await` inside the array literal already executed outside. Fix: interactive form for dependent steps.
- **Lost updates**: read → compute → `update({ data: { balance: next } })` races under concurrency, even inside a READ COMMITTED transaction. Fix: atomic `{ increment }`, a version check via `updateMany` + `count`, or `Serializable` with P2034 retries.
- **Upsert races**: native `INSERT … ON CONFLICT` upserts exist only on PostgreSQL, CockroachDB and SQLite (under conditions); elsewhere `upsert` is find-then-create, so concurrent calls fail with P2002. Fix: catch P2002 and retry.
