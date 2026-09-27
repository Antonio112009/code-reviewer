---
name: AnyIO/Trio task groups and cancel scopes
description: ExceptionGroups from AnyIO 4 task groups and Trio ≥ 0.25 nurseries, swallowed cancellation, level-triggered cancellation breaking cleanup, cancel-scope stack corruption, start_soon readiness races, worker-thread limits and mixing raw asyncio APIs.
priority: 64
activation:
  content:
    - "\\b(?:create_task_group|open_nursery)\\s*\\(|\\bstart_soon\\s*\\(|\\btask_status\\b"
    - "\\bCancelScope\\b|\\b(?:move_on_after|fail_after|move_on_at|fail_at)\\s*\\(|\\bget_cancelled_exc_class\\b|\\btrio\\.Cancelled\\b"
    - "\\bto_thread\\.run_sync\\s*\\(|\\bfrom_thread\\.\\w+|\\bCapacityLimiter\\b|\\bstrict_exception_groups\\b"
sources:
  - https://anyio.readthedocs.io/en/stable/migration.html
  - https://anyio.readthedocs.io/en/stable/cancellation.html
  - https://anyio.readthedocs.io/en/stable/threads.html
  - https://trio.readthedocs.io/en/stable/history.html
---
- **Groups always raise ExceptionGroup**: AnyIO 4 task groups and Trio ≥ 0.25 nurseries (`strict_exception_groups=True`) wrap even a single child error → `except ValueError:` around them never matches. Fix: `except*` (3.11+) or `exceptiongroup.catch`.
- **Swallowed cancellation**: catching `get_cancelled_exc_class()`, `trio.Cancelled` or `BaseException` without re-raising leaves the scope in an undefined state → hangs, ignored timeouts. Fix: always re-raise.
- **Level-triggered cancellation**: in a cancelled scope every `await` raises again, so `await conn.close()` in `except`/`finally` is cancelled at once. Fix: `with CancelScope(shield=True):` or `move_on_after(t, shield=True)`.
- **Scope stack corruption**: entering/exiting cancel scopes or task groups manually (`__aenter__`, `AsyncExitStack`) out of LIFO order → RuntimeError or cancellation hitting the wrong task. Fix: plain nested `with` blocks.
- **`start_soon` readiness race**: it returns before the child is ready. Fix: `await tg.start(fn)` + `task_status.started()`.
- **Worker threads**: `to_thread.run_sync` shares a 40-token default limiter; cancellation waits for the thread (or, with `abandon_on_cancel=True`, leaves it running). Fix: a dedicated `CapacityLimiter`; timeouts inside the call.
- **Raw asyncio inside AnyIO**: `asyncio.create_task`/`Lock`/`sleep` break on the Trio backend and escape supervision. Fix: AnyIO equivalents.
- **Silent timeouts**: `move_on_after()` just continues. Fix: check `cancelled_caught` or use `fail_after()`.
