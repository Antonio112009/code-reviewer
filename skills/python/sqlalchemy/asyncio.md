---
name: asyncio extension
description: SQLAlchemy AsyncSession and AsyncEngine defects — implicit IO raising MissingGreenlet (lazy loads, expired attributes), sessions shared between tasks, engines reused across event loops or never disposed, async_scoped_session leaks and asyncpg prepared statements behind PgBouncer.
priority: 64
activation:
  content:
    - '\b(?:AsyncSession|async_sessionmaker|create_async_engine|async_scoped_session|AsyncEngine|AsyncAttrs|awaitable_attrs)\b'
    - '\bMissingGreenlet\b|\bgreenlet_spawn\b|\brun_sync\('
    - '\+asyncpg://|\bprepared_statement_cache_size\b|\bstatement_cache_size\b'
  examples:
    - 'engine = create_async_engine("postgresql+asyncpg://user:pass@host/db")'
    - 'except MissingGreenlet:'
    - 'await obj.awaitable_attrs.children'
sources:
  - https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html
  - https://docs.sqlalchemy.org/en/20/dialects/postgresql.html#prepared-statement-cache
  - https://docs.sqlalchemy.org/en/20/errors.html#error-xd2s
---
- **Implicit IO**: lazy-loading a relationship, reading an attribute expired by `commit()` or a deferred column inside async code raises `MissingGreenlet` — often only in response serialization. Fix: eager-load (`selectinload`), `expire_on_commit=False`, `await obj.awaitable_attrs.rel`, `lazy="raise"` to surface misses.
- **Session shared across tasks**: one `AsyncSession` used from `asyncio.gather()` or concurrent handlers is unsafe → "concurrent operations are not permitted" errors or corrupted state. Fix: one session per task.
- **Engine across event loops**: an `AsyncEngine` created at import or in another loop (per-test loops, `asyncio.run()` per job, Flask async views) fails with "attached to a different loop". Fix: `await engine.dispose()` before reuse, or `NullPool`.
- **Engine never disposed**: without `await engine.dispose()` at shutdown, pooled connections are closed by garbage collection outside the loop → warnings and dropped connections. Fix: dispose in lifespan/shutdown hooks.
- **async_scoped_session leaks**: it needs `scopefunc=asyncio.current_task` and `await Session.remove()` at the end of each task, or sessions and connections accumulate.
- **PgBouncer transaction pooling with asyncpg**: cached prepared statements break across pooled server connections ("prepared statement ... does not exist/already exists"). Fix: `prepared_statement_cache_size=0` plus a unique `prepared_statement_name_func`, per the asyncpg dialect docs.
