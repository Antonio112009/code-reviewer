---
name: asyncio tasks and fan-out
description: Fire-and-forget tasks garbage-collected mid-flight, gather leaving siblings running, return_exceptions results, asyncio.wait not raising, TaskGroup exception groups, unbounded fan-out and eager task starts (3.12+).
priority: 64
activation:
  content:
    - "\\b(?:create_task|ensure_future)\\s*\\("
    - "\\basyncio\\.(?:gather|wait|as_completed|shield)\\s*\\(|\\bgather\\s*\\(\\s*\\*"
    - "\\bTaskGroup\\b|\\badd_done_callback\\s*\\("
    - "\\beager_(?:task_factory|start)\\b"
sources:
  - https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task
  - https://docs.python.org/3/library/asyncio-task.html#asyncio.gather
  - https://docs.python.org/3/library/asyncio-task.html#task-groups
  - https://docs.python.org/3/library/asyncio-task.html#asyncio.wait
---
- **Unreferenced tasks**: the loop keeps only weak references → a fire-and-forget `create_task(coro)` can be garbage-collected mid-run, and its exception is only logged ("Task exception was never retrieved"). Fix: keep tasks in a set with `add_done_callback(tasks.discard)`, or a `TaskGroup`.
- **`gather` leaves siblings running**: with `return_exceptions=False` the first exception propagates, but the other awaitables keep running → half-applied batches. Fix: `asyncio.TaskGroup` (3.11+) or cancel the rest.
- **`return_exceptions=True`**: results mix values and exception objects → errors treated as data unless each result is checked with `isinstance(r, BaseException)`.
- **`asyncio.wait` doesn't raise**: exceptions stay inside `done` tasks, and timed-out tasks keep running in `pending`. Fix: `.result()` on done tasks; cancel and await pending ones.
- **TaskGroup errors are groups**: failures surface as `ExceptionGroup` after all tasks end → `except SomeError` around the group never matches. Fix: `except* SomeError`.
- **Unbounded fan-out**: `gather(*(fetch(x) for x in items))` starts everything at once → exhausted pools, rate limits, memory. Fix: `asyncio.Semaphore` or a worker pool with a queue.
- **Eager tasks (3.12+)**: with `eager_task_factory` or `create_task(eager_start=True)` (3.14) the coroutine runs inside `create_task()` until its first suspension → ordering and exception timing change. Fix: don't rely on deferred start.
