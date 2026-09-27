---
name: asyncio cancellation and timeouts
description: Swallowed CancelledError (uncancel, 3.11+), cleanup placed in except Exception, asyncio.timeout() catch placement, asyncio.TimeoutError before 3.11, wait_for cancelling the work, shield semantics and awaits without any deadline.
priority: 64
tags: [CWE-400]
activation:
  content:
    - "\\bCancelledError\\b|\\.cancel\\s*\\(|\\buncancel\\s*\\("
    - "\\b(?:wait_for|timeout|timeout_at|shield)\\s*\\("
    - "\\bTimeoutError\\b"
    - "\\bopen_connection\\s*\\(|\\bawait\\s+[\\w.]+\\.(?:get|recv|read|readline|acquire|wait|communicate)\\s*\\("
sources:
  - https://docs.python.org/3/library/asyncio-task.html#task-cancellation
  - https://docs.python.org/3/library/asyncio-task.html#asyncio.timeout
  - https://docs.python.org/3/library/asyncio-task.html#asyncio.wait_for
  - https://docs.python.org/3/library/asyncio-exceptions.html#asyncio.CancelledError
---
- **Swallowed cancellation**: catching `CancelledError` (or `BaseException`, bare `except`) without re-raising breaks `TaskGroup`, `timeout()`, `wait_for` and shutdown → tasks keep running, timeouts never fire. Fix: re-raise; if suppression is intended call `uncancel()` (3.11+).
- **Cleanup only in `except Exception`**: `CancelledError` is a BaseException since 3.8, so that cleanup is skipped on cancellation and timeouts. Fix: `finally`.
- **`timeout()` catch placement**: `asyncio.timeout()` converts cancellation to `TimeoutError` only at the `async with` boundary → `except TimeoutError` inside the block never runs. Fix: catch outside it.
- **Timeout types before 3.11**: `wait_for` raises `asyncio.TimeoutError`, not the builtin `TimeoutError`, on 3.10 and older → `except TimeoutError` misses it. Fix: catch `asyncio.TimeoutError` while supporting 3.10.
- **`wait_for` cancels the work**: on timeout the awaited task is cancelled and awaited, so total time can exceed the timeout → partial side effects. Fix: `asyncio.shield()` for work that must finish.
- **`shield` is not detach**: if the outer task is cancelled, the shielded task runs on unreferenced (may be garbage-collected) and its result or error is lost. Fix: keep a reference; await or log it later.
- **No deadline**: `open_connection`, `reader.read()`, `queue.get()`, `lock.acquire()` or `proc.communicate()` without a timeout hang forever when the peer stalls. Fix: `async with asyncio.timeout(...)`.
