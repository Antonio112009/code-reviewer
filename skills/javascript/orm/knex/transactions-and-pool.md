---
name: Transactions and connection pool
description: Knex transaction and pool defects — queries on knex inside a transaction, provider-style transactions left open, forUpdate outside transactions, instances created per request, missing destroy() in scripts, pool minimums and returning() ignored on MySQL.
priority: 64
tags: [CWE-362, CWE-400]
activation:
  content:
    - "\\.transaction\\s*\\(|\\.transacting\\s*\\(|\\.forUpdate\\s*\\(|\\.forShare\\s*\\(|\\btrx\\.(?:commit|rollback)\\s*\\("
    - "\\bknex\\s*\\(\\s*\\{|\\brequire\\s*\\(\\s*['\"]knex['\"]\\s*\\)\\s*\\(|\\bpool\\s*:\\s*\\{|\\bacquireConnectionTimeout\\b|\\.destroy\\s*\\("
    - "\\.returning\\s*\\("
  examples:
    - 'const trx = await knex.transaction();'
    - 'const db = knex({ client: "pg", pool: { min: 0, max: 10 } });'
    - 'const [row] = await knex("users").insert(user).returning("*");'
sources:
  - https://knexjs.org/guide/transactions.html
  - https://knexjs.org/guide/
  - https://knexjs.org/guide/query-builder.html
---
- **Escaping trx**: queries on `knex`/`db` inside `knex.transaction(async (trx) => …)` use another connection — they are not rolled back, and with small pools they wait for the connection the transaction holds (deadlock). Fix: use `trx` for every query.
- **Provider transactions**: `const trx = await knex.transaction()` must `commit()` or `rollback()` on every path; a missed branch or thrown error keeps the connection checked out until `acquireConnectionTimeout` (60 s) starves the pool. Fix: handler form or `try/finally`.
- **forUpdate outside trx**: `.forUpdate()` on a query not running in a transaction releases the lock when the statement ends → no protection against concurrent read-modify-write. Fix: read and write in the same `trx`.
- **Instances and shutdown**: creating `knex(config)` per request or per module opens new pools; scripts, jobs and lambdas that never call `knex.destroy()` hang on exit or leak connections. Fix: one shared instance; `destroy()` in `finally` for CLIs.
- **Pool minimum**: the default `pool.min: 2` keeps idle connections that proxies and databases silently close → first-query errors after idle periods. Fix: `min: 0` (recommended by the docs), sensible timeouts.
- **returning() on MySQL**: `returning()` works on PostgreSQL, MSSQL, SQLite 3.35+ and Oracle; MySQL ignores it, so `const [row] = await knex('t').insert(x).returning('*')` yields an insert id, not a row. Fix: re-select by id on MySQL.
