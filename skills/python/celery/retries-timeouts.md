---
name: Retries and time limits
description: Celery retry and timeout defects — Retry exceptions swallowed by broad handlers, max_retries defaults and infinite retries, autoretry_for retrying non-transient or non-idempotent work, retries without backoff, missing time limits, swallowed SoftTimeLimitExceeded and pools where limits do not work.
priority: 64
tags: [CWE-400, CWE-755]
activation:
  content:
    - '\bself\.retry\(|\.retry\(\s*exc\s*='
    - '\b(?:autoretry_for|retry_backoff|retry_backoff_max|retry_jitter|max_retries|default_retry_delay|dont_autoretry_for|retry_kwargs)\b'
    - '\b(?:time_limit|soft_time_limit|task_time_limit|task_soft_time_limit|SoftTimeLimitExceeded)\b'
    - '\bbind\s*=\s*True\b'
sources:
  - https://docs.celeryq.dev/en/stable/userguide/tasks.html#retrying
  - https://docs.celeryq.dev/en/stable/userguide/tasks.html#automatic-retry-for-known-exceptions
  - https://docs.celeryq.dev/en/stable/userguide/workers.html#time-limits
  - https://docs.celeryq.dev/en/stable/userguide/configuration.html#task-time-limit
---
- **Retry swallowed**: `self.retry()` works by raising `celery.exceptions.Retry`; called inside a `try` whose `except Exception` catches it (or with `throw=False`), the task finishes as a success and never retries. Fix: `raise self.retry(exc=exc)` outside broad handlers.
- **Retry budget surprises**: `max_retries` defaults to 3 and then raises the original error (or `MaxRetriesExceededError` without `exc=`); `max_retries=None` retries forever and clogs queues.
- **Blanket autoretry**: `autoretry_for=(Exception,)` retries validation errors and bugs forever-ish, and replays non-idempotent side effects (charges, emails) after partial success. Fix: list transient exceptions only, make side effects idempotent.
- **No backoff**: fixed `countdown` or `default_retry_delay` (3 min) retries synchronise and hammer a failing dependency. Fix: `retry_backoff=True` with `retry_jitter` and `retry_backoff_max`.
- **No time limits**: `task_time_limit` and `task_soft_time_limit` default to none → a hung HTTP call or lock wait holds a worker slot forever. Fix: limits plus I/O timeouts.
- **Swallowed soft limit**: `SoftTimeLimitExceeded` caught by a broad `except Exception` lets the task continue until the hard limit kills the child without cleanup.
- **Limits that do not apply**: time limits need `SIGUSR1` (not on Windows); the gevent pool has no soft limits and cannot enforce the hard limit on blocking code.
