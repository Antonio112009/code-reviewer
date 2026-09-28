---
name: Beat, periodic and delayed tasks
description: Celery scheduling defects — several beat schedulers (or worker -B replicas) duplicating runs, overlapping periodic executions, backlogs replayed after outages, crontab time zones, django-celery-beat bulk edits not reloaded and ETA/countdown tasks held in worker memory.
priority: 62
tags: [CWE-362, CWE-400]
activation:
  content:
    - '\b(?:beat_schedule|CELERY_BEAT_SCHEDULE|crontab|solar|PeriodicTask|PeriodicTasks|IntervalSchedule|CrontabSchedule)\b'
    - '\bcelery\b[^\n]{0,80}\b(?:beat|worker)\b[^\n]{0,80}(?:\s-B\b|--beat\b)'
    - '\b(?:countdown|eta)\s*=|\bworker_eta_task_limit\b|\b(?:timezone|enable_utc)\s*='
  examples:
    - 'beat_schedule = {"nightly": {"schedule": crontab(hour=2)}}'
    - 'celery -A proj worker -B'
    - 'send_reminder.apply_async(countdown=60)'
sources:
  - https://docs.celeryq.dev/en/stable/userguide/periodic-tasks.html
  - https://github.com/celery/django-celery-beat
  - https://docs.celeryq.dev/en/stable/userguide/calling.html#eta-and-countdown
  - https://docs.celeryq.dev/en/stable/history/whatsnew-5.6.html
---
- **Several schedulers**: more than one `celery beat` process, or `worker -B` (not for production) in every replica, sends each periodic task once per scheduler → duplicate emails, billing or reports. Fix: exactly one beat, or a locking scheduler.
- **Overlapping runs**: a periodic task that can run longer than its interval starts again while the previous run is active → double processing. Fix: a lock (e.g. Redis `SET NX` with expiry) or a guard in the task.
- **Backlog after outage**: messages sent while workers are down pile up and all run on recovery. Fix: `expires` in the schedule entry's `options`.
- **Time zones**: `crontab()` fires in the `timezone` setting (UTC by default); local-time crontabs skip or repeat around DST. With django-celery-beat, changing `TIME_ZONE` keeps the old schedule until `last_run_at` is reset.
- **Bulk edits not reloaded**: django-celery-beat reloads the schedule only when a `PeriodicTask` save bumps the change counter; `QuerySet.update()` needs `PeriodicTasks.update_changed()`.
- **Far-future ETA tasks**: `countdown`/`eta` tasks are reserved and held in worker memory until due → many of them exhaust memory. Fix: a scheduler or DB-backed jobs for long delays; `worker_eta_task_limit` (5.6+).
