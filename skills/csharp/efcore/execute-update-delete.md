---
name: ExecuteUpdate and ExecuteDelete
description: EF Core 7+ bulk operations that bypass the change tracker, SaveChanges overrides and interceptors, transactions and concurrency tokens, plus client-side cascade behaviours that ExecuteDelete doesn't apply.
priority: 66
tags: [CWE-362, CWE-778]
activation:
  content:
    - '\bExecute(?:Update|Delete)(?:Async)?\(|\bSetProperty\('
sources:
  - https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete
  - https://learn.microsoft.com/en-us/ef/core/saving/cascade-delete
  - https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors
---
- **Tracker bypassed**: `ExecuteUpdate`/`ExecuteDelete` run immediately in the database; already-tracked entities keep old values and a later `SaveChanges` can overwrite the bulk change. Fix: don't mix with tracked edits in one context, or `ChangeTracker.Clear()`/reload.
- **SaveChanges logic skipped**: `SaveChanges` overrides and `SaveChangesInterceptor`s (audit columns, timestamps, soft delete, outbox, domain events) don't run → `ExecuteDelete` hard-deletes soft-deletable rows, audit data goes stale. Fix: replicate the logic in the statement or use `SaveChanges`.
- **Not atomic together**: consecutive `ExecuteUpdate`/`ExecuteDelete` calls (and a following `SaveChanges`) run in separate implicit transactions → partial changes on failure. Fix: explicit `BeginTransactionAsync` (inside the execution strategy when retries are on).
- **No concurrency control**: tokens aren't checked and the returned row count is often ignored → lost updates go unnoticed. Fix: token in `Where`, check the affected count.
- **Cascades**: only database-level cascades apply — EF's client-side behaviours (`ClientCascade`, `ClientSetNull`, orphan deletion) don't → FK violations or orphans. Fix: delete dependents first or configure DB cascades.
- **Query filters apply**: global filters (tenant, soft delete) narrow the statement; adding `IgnoreQueryFilters()` to reach deleted rows also drops the tenant predicate. Fix: re-add tenant conditions explicitly.
