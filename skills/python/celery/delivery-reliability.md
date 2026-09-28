---
name: Acknowledgement, redelivery and worker safety
description: Celery delivery defects — early acknowledgement losing tasks, acks_late without idempotency, failed tasks acked by default, Redis/SQS visibility timeouts re-running long or delayed tasks, prefetching behind long tasks, shutdown loss and leaking long-lived worker children.
priority: 68
tags: [CWE-362, CWE-400]
activation:
  content:
    - '\b(?:acks_late|task_acks_late|reject_on_worker_lost|task_reject_on_worker_lost|task_acks_on_failure_or_timeout)\b'
    - '\b(?:visibility_timeout|broker_transport_options|worker_prefetch_multiplier|worker_soft_shutdown_timeout|worker_enable_soft_shutdown_on_idle)\b'
    - '\bCELERY_(?:TASK_ACKS_LATE|WORKER_PREFETCH_MULTIPLIER|BROKER_TRANSPORT_OPTIONS)\b'
    - '\b(?:worker_max_tasks_per_child|worker_max_memory_per_child|max_tasks_per_child)\b'
  examples:
    - '@shared_task(acks_late=True)'
    - 'broker_transport_options = {"visibility_timeout": 3600}'
    - 'CELERY_TASK_ACKS_LATE = True'
    - 'worker_max_tasks_per_child = 100'
sources:
  - https://docs.celeryq.dev/en/stable/userguide/tasks.html
  - https://docs.celeryq.dev/en/stable/getting-started/backends-and-brokers/redis.html#visibility-timeout
  - https://docs.celeryq.dev/en/stable/userguide/configuration.html
  - https://docs.celeryq.dev/en/stable/history/whatsnew-5.5.html
---
- **Early acknowledgement**: `acks_late` is off by default, so a task is acked before it runs and a crash, OOM kill or deploy loses it. Fix: `acks_late=True` for important tasks, which must then be idempotent.
- **Killed children still ack**: with `acks_late`, a child killed by a signal (OOM, `SIGKILL`) is acked anyway unless `task_reject_on_worker_lost=True` (which risks redelivery loops).
- **Failures acked**: `task_acks_on_failure_or_timeout` defaults to `True`, so failed or timed-out tasks are not redelivered even with `acks_late`.
- **Visibility timeout (Redis/SQS)**: tasks unacknowledged longer than `visibility_timeout` (Redis 1 h, SQS 30 min by default) are redelivered → long tasks, or `countdown`/`eta`/retry delays beyond it, run repeatedly. Fix: raise it above the longest task and delay.
- **Prefetch behind long tasks**: `worker_prefetch_multiplier` 4 reserves messages per process, so short tasks wait behind a busy process's long ones. Fix: `worker_prefetch_multiplier=1` with `acks_late` for long tasks.
- **Cold shutdown**: a cold shutdown (container kill after the grace period) cancels running tasks, which on Redis/SQS reappear only after the visibility timeout. Fix (5.5+): `worker_soft_shutdown_timeout` (default 0, off) so tasks are re-queued first.
- **Leaking long-lived children**: prefork children never recycle by default (`worker_max_tasks_per_child`/`worker_max_memory_per_child` unset) → memory grows until the OOM killer takes running tasks. Fix: set a limit.
