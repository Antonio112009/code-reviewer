---
name: Transactions, locking and sync
description: Sequelize transaction scope and schema-sync defects — queries missing { transaction } without CLS, unmanaged transactions left open, managed callbacks that swallow errors, locks outside transactions, side effects before commit and sync({ alter/force }) in production.
priority: 66
tags: [CWE-362, CWE-667]
activation:
  content:
    - "\\bsequelize\\.transaction\\s*\\(|\\btransaction\\s*:\\s*\\w+|\\b(?:t|tx|trx|transaction)\\.(?:commit|rollback|afterCommit|LOCK)\\b"
    - "\\buseCLS\\s*\\(|\\block\\s*:|\\bskipLocked\\b"
    - "\\.sync\\s*\\(\\s*\\{|\\bsequelize\\.sync\\s*\\("
sources:
  - https://sequelize.org/docs/v6/other-topics/transactions/
  - https://sequelize.org/docs/v6/core-concepts/model-basics/
  - https://sequelize.org/docs/v6/other-topics/migrations/
---
- **Missing `transaction: t`**: without CLS (`Sequelize.useCLS`), every query, association helper (`user.addRole(role, { transaction: t })`) and hook query needs the option — omitted ones run outside and survive rollback. Fix: pass `t` everywhere or enable CLS.
- **Unmanaged transactions**: `const t = await sequelize.transaction()` without `rollback()` in `catch` and `commit()` on every path holds the connection → pool exhaustion. Fix: the managed callback form.
- **Swallowed errors**: in `sequelize.transaction(async (t) => …)` only a thrown error rolls back — catching inside the callback, or returning an error value, commits partial work. Fix: rethrow.
- **Locks outside transactions**: `lock: true`/`t.LOCK.UPDATE` on a query without a transaction holds the row lock only for that statement. Fix: read and write in the same `t`; `skipLocked` for job queues.
- **Side effects before commit**: e-mails, events or cache writes inside the callback happen even when it later rolls back. Fix: `t.afterCommit(() => …)`.
- **sync in production**: `sequelize.sync({ alter: true })` or `{ force: true }` at startup drops and recreates tables or columns → data loss. Fix: migrations (sequelize-cli, umzug); `sync` only in tests.
