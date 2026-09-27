---
name: Queued jobs, listeners and batches
description: Queue reliability — dispatching inside transactions, timeout vs retry_after double processing, non-idempotent jobs, SerializesModels re-fetching, unique and overlap locks, single-attempt defaults and cancelled batches.
priority: 68
tags: [CWE-362, CWE-367, CWE-400]
activation:
  content:
    - '\bShouldQueue\b|\bShouldBeUnique\w*\b|\bSerializesModels\b|->afterCommit\s*\('
    - '::dispatch(?:Sync|If|Unless)?\s*\(|\bdispatch\s*\(|\bBus::(?:batch|chain)\s*\('
    - '\bretry_after\b|\$(?:tries|timeout|backoff|maxExceptions)\b|#\[(?:Tries|Timeout|Backoff|UniqueFor|FailOnTimeout)\b|\bWithoutOverlapping\b'
sources:
  - https://laravel.com/docs/13.x/queues
  - https://laravel.com/docs/13.x/queues#jobs-and-database-transactions
  - https://laravel.com/docs/13.x/queues#job-expirations-and-timeouts
---
- **Dispatch inside a transaction**: jobs, queued listeners, mail, notifications and broadcasts dispatched in `DB::transaction` can run before commit or after a rollback → missing rows or actions on undone data. Fix: `->afterCommit()`, `after_commit => true`, `ShouldQueueAfterCommit`.
- **timeout vs retry_after**: a worker `--timeout`/job timeout not several seconds below the connection's `retry_after` (default 90) → the job is re-delivered while still running and processed twice.
- **Not idempotent**: delivery is at-least-once (retries, crashes, re-delivery) → double charges or e-mails. Fix: idempotency keys and unique constraints.
- **SerializesModels**: only the id is queued and the model is re-fetched at handle time → changes since dispatch are seen, and deleted models throw `ModelNotFoundException` unless `deleteWhenMissingModels`. Pass values that must not change.
- **Locks**: `ShouldBeUnique` and `WithoutOverlapping` need a lock-capable cache shared by all servers; `WithoutOverlapping` without `expireAfter()` stays locked after a crash.
- **One attempt by default**: jobs are tried once unless tries are set, and releases by `WithoutOverlapping`/`RateLimited` consume attempts → transient errors or overlaps fail jobs permanently.
- **Batches**: jobs of a cancelled batch keep running unless they check `$this->batch()->cancelled()` (or use `SkipIfBatchCancelled`) → work continues after cancellation.
