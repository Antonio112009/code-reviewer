---
name: Signals
description: Django signal receiver defects — receivers never connected or garbage-collected, duplicate registrations, save() recursion, handlers that assume commit or saved M2M data, raw fixture saves and exceptions that stop other receivers.
priority: 58
activation:
  files: ["**/signals.py", "**/signals/*.py", "**/receivers.py"]
  content:
    - '@receiver\('
    - '\b(?:pre_save|post_save|pre_delete|post_delete|m2m_changed|request_finished|user_logged_in)\b'
    - '\.connect\(|\bSignal\(|\.send(?:_robust)?\(|\.asend(?:_robust)?\('
sources:
  - https://docs.djangoproject.com/en/stable/topics/signals/
  - https://docs.djangoproject.com/en/stable/ref/signals/
---
- **Receiver never connected**: `@receiver` functions in a `signals` module that nothing imports never run (tests often import them, hiding it). Fix: import the module in `AppConfig.ready()`.
- **Garbage-collected receiver**: `connect()` stores weak references, so a nested function, lambda or closure stops firing once collected. Fix: module-level function or `weak=False`.
- **Duplicate receivers**: bound methods connected per instance, or `ready()` running twice, register multiple times → duplicate emails or charges. Fix: `dispatch_uid`.
- **save() recursion**: calling `instance.save()` inside its own `post_save` handler re-triggers the signal → recursion or extra writes. Fix: `Model.objects.filter(pk=...).update(...)`.
- **post_save is not post-commit**: handlers that notify or enqueue run inside the caller's transaction and fire even if it rolls back. Fix: `transaction.on_commit()` inside the handler.
- **M2M not saved yet**: `post_save` for an object saved by a `ModelForm` or DRF serializer runs before M2M data is written → handler sees old relations. Fix: `m2m_changed`, or `on_commit`.
- **raw fixture saves**: `post_save`/`pre_save` with `raw=True` (`loaddata`) must not query or modify other rows. Fix: return early when `raw`.
- **Exceptions stop dispatch**: `send()` propagates the first receiver error and skips the rest, failing the caller's request. Fix: `send_robust()` for optional side effects.
