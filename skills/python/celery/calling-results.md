---
name: Calling tasks and using results
description: Celery calling defects — tasks enqueued before the database transaction commits, blocking AsyncResult.get() in tasks and web requests, result-backend growth, chords that need results, errbacks called repeatedly and eager mode hiding production behaviour.
priority: 66
tags: [CWE-362, CWE-400]
activation:
  content:
    - '\.(?:delay|apply_async|delay_on_commit|apply_async_on_commit)\('
    - '\.get\([^)\n]{0,60}\)|\bAsyncResult\(|\bdisable_sync_subtasks\b'
    - '\b(?:chord|group|chain)\(|\blink_error\s*=|\.link_error\('
    - '\b(?:ignore_result|task_ignore_result|result_expires|result_backend|task_always_eager|CELERY_TASK_ALWAYS_EAGER)\b'
sources:
  - https://docs.celeryq.dev/en/stable/userguide/tasks.html#database-transactions
  - https://docs.celeryq.dev/en/stable/django/first-steps-with-django.html
  - https://docs.celeryq.dev/en/stable/userguide/canvas.html
  - https://docs.celeryq.dev/en/stable/userguide/configuration.html#result-expires
---
- **Enqueued before commit**: `.delay()` inside a Django `atomic()` block or before `session.commit()` lets the worker run before the row exists or after a rollback. Fix: `delay_on_commit()` (Celery 5.4+, `DjangoTask`; returns no task id) or `transaction.on_commit()`; enqueue after `commit()` with SQLAlchemy.
- **Waiting inside a task**: `result.get()` in a task raises `RuntimeError` by default; `disable_sync_subtasks=False` risks deadlock once the pool is exhausted. Fix: `chain`/`chord` callbacks.
- **Waiting in a web request**: `AsyncResult.get()` without `timeout` blocks a web worker until the task finishes or forever if it is lost. Fix: timeouts, or return the task id and poll.
- **Result backend growth**: with a result backend, every task stores its result unless `ignore_result=True`; `result_expires` (1 day) cleanup on database/filesystem backends runs only while `celery beat` runs → unbounded tables.
- **Chords need results**: chord header tasks must not ignore results and need a non-RPC result backend; if a header task fails, the body never runs unless an errback handles it.
- **Errbacks run repeatedly**: a `link_error` on a group is passed down to every member and can fire once per failed task. Fix: idempotent errbacks.
- **Eager mode hides reality**: `task_always_eager=True` in tests (or leaked into production settings) runs tasks inline, skipping message serialization and running inside the caller's transaction → bugs appear only in production.
