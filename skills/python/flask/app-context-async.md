---
name: App context, threads and async views
description: Flask context and concurrency defects — request/current_app used in threads, executors, tasks or streaming generators, per-request data in module globals, async views whose spawned tasks are cancelled, loop-bound clients and teardown handlers that leave sessions dirty.
priority: 62
activation:
  content:
    - '\b(?:current_app|copy_current_request_context|stream_with_context|app_context|test_request_context|teardown_appcontext|teardown_request)\b'
    - '\bThread\(|\bThreadPoolExecutor\(|\.submit\(|\bcreate_task\('
    - '@\w+\.(?:route|get|post|put|patch|delete)\([^)\n]{0,120}\)[ \t]*\r?\n[ \t]*async[ \t]+def\b'
    - '\byield\b[^\n]{0,80}\brequest\.'
sources:
  - https://flask.palletsprojects.com/en/stable/appcontext/
  - https://flask.palletsprojects.com/en/stable/patterns/streaming/
  - https://flask.palletsprojects.com/en/stable/async-await/
  - https://flask.palletsprojects.com/en/stable/changes/
---
- **Context outside its worker**: `request`, `session`, `g` or `current_app` used in `threading.Thread`, executor jobs, Celery tasks or scripts → `RuntimeError: Working outside of ... context`, or the wrong app. Fix: pass plain values, `copy_current_request_context`, `current_app._get_current_object()`, `with app.app_context():`.
- **Streaming generators**: a generator returned from a view that reads `request` or `session` runs after the view returned → `RuntimeError` mid-stream. Fix: `stream_with_context(...)` (works in async views since 3.1.2).
- **Per-request data in globals**: module-level variables or class attributes holding the current user or request data leak between requests under threaded or gevent servers. Fix: `g` or function arguments.
- **Async views cancel spawned work**: each `async def` view runs in its own short-lived event loop; tasks from `asyncio.create_task()` are cancelled when the view returns, and the worker is still blocked for the request. Fix: a task queue.
- **Loop-bound clients**: async clients, engines or pools created at import or in another view's loop fail with "attached to a different loop" in later async views. Fix: create per request or run under an ASGI framework.
- **Teardown hygiene**: with plain SQLAlchemy, no `teardown_appcontext` handler calling `session.remove()` leaks sessions and connections across requests; in Flask ≤3.1 one teardown callback that raises skips the remaining ones.
