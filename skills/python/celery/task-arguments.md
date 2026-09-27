---
name: Task arguments and serialization
description: Celery payload defects — ORM objects passed to tasks, JSON round-trips that change types, pickle in accept_content, task signatures changed while messages are queued, large payloads and secrets stored in brokers, result backends and logs.
priority: 64
tags: [CWE-502, CWE-532]
activation:
  content:
    - '\.(?:delay|apply_async|s|si|signature)\('
    - '\b(?:accept_content|task_serializer|result_serializer|CELERY_ACCEPT_CONTENT|CELERY_TASK_SERIALIZER)\b'
    - '@(?:shared_task|\w+\.task)\b'
sources:
  - https://docs.celeryq.dev/en/stable/userguide/tasks.html#state
  - https://docs.celeryq.dev/en/stable/userguide/calling.html#serializers
  - https://docs.celeryq.dev/en/stable/userguide/security.html
  - https://github.com/celery/kombu/blob/main/kombu/utils/json.py
---
- **ORM objects as arguments**: with the default `json` serializer, model instances raise `EncodeError` at `.delay()`; with pickle the task gets a snapshot and its `save()` overwrites newer changes. Fix: pass primary keys and reload inside the task.
- **JSON changes types**: tuples arrive as lists, dict keys become strings (`{1: x}` → `{"1": x}`), sets and custom objects fail to encode; kombu only round-trips `datetime`, `date`, `time`, `Decimal`, `UUID` and `bytes`.
- **Pickle accepted**: `pickle` in `accept_content` or as `task_serializer` lets anyone who can publish to the broker run code on workers. Fix: JSON only, authenticated brokers, message signing where needed.
- **Signature changes vs. queued messages**: renaming, removing or adding required parameters while old messages (including ETA and retry messages) are queued → `TypeError` on delivery. Fix: add optional keyword arguments with defaults; remove old ones after the queues drain.
- **Large payloads**: file contents or big lists as arguments bloat broker memory and can exceed transport limits (e.g. SQS). Fix: store the data and pass a reference.
- **Secrets in arguments**: passwords, tokens or PII in task args persist in the broker, the result backend (`result_extended`), worker logs and monitoring UIs. Fix: pass ids and load secrets inside the task.
