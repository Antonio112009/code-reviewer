---
name: EF Core transactions and retries
description: Transaction defects with EF Core — user transactions rejected by retrying execution strategies, non-idempotent retried blocks and commit-failure duplicates, multi-step writes without a transaction, savepoints with MARS and contexts not sharing a transaction.
priority: 66
tags: [CWE-362, CWE-667]
activation:
  content:
    - '\bBeginTransaction(?:Async)?\(|\bCommit(?:Async)?\(|\bRollback(?:Async)?\(|\bIDbContextTransaction\b'
    - '\bCreateExecutionStrategy\(|\bEnableRetryOnFailure\(|\bUseTransaction(?:Async)?\(|\bCreateSavepoint(?:Async)?\('
  examples:
    - 'await using IDbContextTransaction transaction = await context.Database.BeginTransactionAsync();'
    - 'await transaction.CommitAsync();'
    - 'var strategy = context.Database.CreateExecutionStrategy();'
sources:
  - https://learn.microsoft.com/en-us/ef/core/miscellaneous/connection-resiliency
  - https://learn.microsoft.com/en-us/ef/core/saving/transactions
---
- **Retries vs user transactions**: with `EnableRetryOnFailure` (SQL Server/Azure SQL, Npgsql, …) a manual `BeginTransaction` or ambient `TransactionScope` throws `InvalidOperationException` ("does not support user-initiated transactions"). Fix: wrap the whole unit in `db.Database.CreateExecutionStrategy().ExecuteAsync(...)`.
- **Retried side effects**: the retry delegate re-runs everything inside it (HTTP calls, message publishes, in-memory mutations); a connection drop during commit leaves the outcome unknown and a retry inserts duplicates with store-generated keys. Fix: DB-only idempotent delegates, client-generated keys or `verifySucceeded`.
- **Multi-step writes**: several `SaveChanges`, `ExecuteUpdate` or raw SQL calls without an explicit transaction → each commits separately; a failure leaves partial data. Fix: one `SaveChanges`, or `BeginTransactionAsync` + `CommitAsync`.
- **Savepoints and MARS**: EF creates a savepoint before `SaveChanges` inside a user transaction, but not when SQL Server MARS is enabled → after a failed `SaveChanges` the transaction state is unknown. Fix: roll back the whole transaction.
- **Several contexts**: two `DbContext`s participate in one transaction only when they share the same `DbConnection` and call `UseTransaction(tx)`; otherwise they commit independently. Fix: share connection and transaction explicitly.
