---
name: TransactionScope
description: System.Transactions defects — Serializable isolation and 1-minute timeout defaults, missing async flow across await, silent escalation to distributed transactions (.NET 7+ Windows-only), forgotten Complete() and non-transactional side effects inside a scope.
priority: 66
tags: [CWE-362, CWE-833]
activation:
  content:
    - '\bTransactionScope\b|\bTransactionScopeAsyncFlowOption\b|\bTransactionOptions\b'
    - '\bTransaction\.Current\b|\bImplicitDistributedTransactions\b'
  examples:
    - 'using var scope = new TransactionScope(TransactionScopeOption.Required, TransactionScopeAsyncFlowOption.Enabled);'
    - 'var options = new TransactionOptions { IsolationLevel = IsolationLevel.ReadCommitted };'
    - 'if (Transaction.Current is not null) throw new InvalidOperationException();'
    - 'TransactionManager.ImplicitDistributedTransactions = true;'
sources:
  - https://learn.microsoft.com/en-us/dotnet/api/system.transactions.transactionscope
  - https://learn.microsoft.com/en-us/archive/blogs/dbrowne/using-new-transactionscope-considered-harmful
  - https://learn.microsoft.com/en-us/dotnet/api/system.transactions.transactionmanager.implicitdistributedtransactions
  - https://learn.microsoft.com/en-us/ef/core/saving/transactions
---
- **Serializable by default**: `new TransactionScope()` uses `IsolationLevel.Serializable` and a 1-minute timeout → range locks, deadlocks and blocking under load. Fix: `new TransactionOptions { IsolationLevel = IsolationLevel.ReadCommitted }`.
- **No async flow**: a scope spanning `await` without `TransactionScopeAsyncFlowOption.Enabled` → "must be disposed on the same thread" exceptions, or later commands run outside the transaction. Fix: pass `TransactionScopeAsyncFlowOption.Enabled`.
- **Distributed escalation**: two connections in one scope (different connection strings, or two open at once on some providers) escalate to a distributed transaction → `PlatformNotSupportedException` on .NET ≤ 6 and non-Windows; .NET 7+ needs Windows and `ImplicitDistributedTransactions = true`. Fix: one connection.
- **Complete and timeouts**: forgetting `scope.Complete()` silently rolls back; work longer than `Timeout` (default 1 min, machine `MaxTimeout` 10 min) aborts. Fix: call `Complete()` last; size timeouts explicitly.
- **Side effects inside the scope**: e-mails, HTTP calls and message publishes aren't transactional → they happen even when the database work rolls back. Fix: outbox pattern, publish after commit.
