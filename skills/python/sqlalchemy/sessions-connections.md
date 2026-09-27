---
name: Sessions, engines and pools
description: SQLAlchemy session and connection defects — shared or never-closed sessions, missing rollback after errors, expire_on_commit reloads and DetachedInstanceError, engines created per request, pool sizing versus server limits, stale connections and pools inherited across fork.
priority: 66
tags: [CWE-362, CWE-400, CWE-404]
activation:
  content:
    - '\b(?:Session|sessionmaker|scoped_session|create_engine|engine_from_config)\('
    - '\b(?:expire_on_commit|pool_size|max_overflow|pool_pre_ping|pool_recycle|pool_timeout|poolclass|NullPool|QueuePool)\b'
    - '\bsession\.(?:commit|rollback|close|remove|merge|expunge)\('
    - '\b(?:PendingRollbackError|DetachedInstanceError)\b|\.dispose\('
sources:
  - https://docs.sqlalchemy.org/en/20/orm/session_basics.html
  - https://docs.sqlalchemy.org/en/20/core/pooling.html
  - https://docs.sqlalchemy.org/en/20/errors.html
  - https://docs.sqlalchemy.org/en/20/orm/session_state_management.html
---
- **Shared Session**: a module-level `Session()` or one session used by several threads or tasks → corrupted identity maps and interleaved transactions. Fix: one session per request/task, or `scoped_session` + `remove()`.
- **Session never closed**: sessions created without `with Session() as s:` or `close()` keep connections checked out → pool exhaustion (`QueuePool limit ... reached`).
- **No rollback after failure**: after a failed `flush`/`commit`, continuing to use the session raises `PendingRollbackError` on every later call, poisoning pooled or scoped sessions. Fix: `with session.begin():` or `rollback()` in `except`.
- **expire_on_commit**: the default `True` expires every instance on commit → touching attributes afterwards reloads each object (N queries) and raises `DetachedInstanceError` once the session is closed. Fix: `expire_on_commit=False` for read-after-commit flows, or reload.
- **Engine per request**: `create_engine()` inside a handler or task builds a new pool each call → connection storms and leaks. Fix: one engine per process.
- **Pool sizing**: `pool_size + max_overflow` (default 5 + 10) per process × workers/replicas exceeding the server's `max_connections` → connection errors under load.
- **Stale connections**: without `pool_pre_ping=True` or a `pool_recycle` below server/proxy idle timeouts (MySQL `wait_timeout`) → sporadic "server has gone away" errors.
- **Pools across fork**: an engine created before `fork` (gunicorn `--preload`, multiprocessing) shares sockets with children. Fix: create after fork or call `engine.dispose(close=False)` in the child.
