---
name: Background tasks framework (6.0+)
description: django.tasks defects — the default ImmediateBackend running work inside the request, dev-only backends in production, failures recorded instead of raised, JSON round-trip arguments, enqueueing before commit and result APIs that raise.
priority: 64
activation:
  versions: { framework.django: ">=6.0" }
  content:
    - '^[ \t]*from[ \t]+django\.tasks\b'
    - '\.a?enqueue\(|\.a?get_result\(|\bdefault_task_backend\b'
    - '\bTASKS\s*=|\b(?:ImmediateBackend|DummyBackend)\b'
  examples:
    - 'from django.tasks import task'
    - 'result = send_email.enqueue(order.id)'
    - 'TASKS = {"default": {"BACKEND": "django.tasks.backends.immediate.ImmediateBackend"}}'
sources:
  - https://docs.djangoproject.com/en/dev/topics/tasks/
  - https://docs.djangoproject.com/en/dev/ref/tasks/
  - https://docs.djangoproject.com/en/dev/releases/6.0/
---
- **Runs inside the request**: without a `TASKS` setting the default `ImmediateBackend` executes `enqueue()` synchronously → slow requests and timeouts, no retries or isolation. Fix: a production backend with real workers (Django ships none).
- **Dev-only backends deployed**: `DummyBackend` never executes tasks and `ImmediateBackend` is for development and tests → work silently dropped or inline in production settings.
- **Failures are recorded, not raised**: exceptions land in `TaskResult.errors` with status `FAILED`, even with `ImmediateBackend`; callers that never check the result never notice.
- **JSON round-trip arguments**: arguments and return values must survive `json.dumps`/`json.loads` → `datetime` raises `TypeError`, tuples come back as lists, model instances are unsupported. Fix: pass ids and ISO strings.
- **Enqueued before commit**: `task.enqueue()` inside `atomic()` lets a worker run before the rows exist. Fix: `transaction.on_commit(partial(task.enqueue, ...))`.
- **Result APIs raise**: `get_result()` raises `NotImplementedError` on backends without result storage (including `ImmediateBackend`); `return_value` raises `ValueError` until the status is `SUCCESSFUL`; a fetched `TaskResult` is a snapshot until `refresh()`.
