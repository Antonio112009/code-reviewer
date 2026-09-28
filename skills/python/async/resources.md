---
name: Async resource cleanup
description: Async generators abandoned mid-iteration (aclosing), @asynccontextmanager without try/finally, StreamWriter drain/wait_closed and yielding inside task groups, timeouts or cancel scopes.
priority: 60
activation:
  content:
    - "\\basync\\s+for\\b|\\baclosing\\s*\\(|\\baclose\\s*\\("
    - "@(?:contextlib\\.)?asynccontextmanager\\b"
    - "\\bopen_connection\\s*\\(|\\bStreamWriter\\b|\\.drain\\s*\\(|\\bwait_closed\\s*\\("
    - "^[ \\t]*yield\\b"
  examples:
    - 'async for chunk in gen():'
    - '@asynccontextmanager'
    - 'await writer.drain()'
    - '    yield chunk'
sources:
  - https://docs.python.org/3/library/contextlib.html#contextlib.aclosing
  - https://docs.python.org/3/library/asyncio-stream.html#asyncio.StreamWriter.drain
  - https://anyio.readthedocs.io/en/stable/cancellation.html#avoiding-cancel-scope-stack-corruption
---
- **Abandoned async generators**: `break` or an exception inside `async for` leaves the generator's `finally`/`async with` cleanup to garbage collection → it runs later in another task or never → leaked connections, held locks. Fix: `contextlib.aclosing(gen())` (3.10+).
- **`@asynccontextmanager` without try/finally**: exceptions and cancellation from the `async with` body re-enter at `yield`, so cleanup after a bare `yield` is skipped. Fix: `try: yield x` / `finally: await cleanup()`.
- **Stream backpressure**: `StreamWriter.write()` without `await writer.drain()` buffers without limit for slow peers; `close()` without `await writer.wait_closed()` loses errors and the final flush. Fix: drain after writes; await `wait_closed()`.
- **Yield inside scopes**: an async generator yielding inside `TaskGroup`, `asyncio.timeout()` or an AnyIO cancel scope runs the consumer's code inside that scope → cancellations and errors hit the wrong task. Fix: don't yield there; use a queue or memory stream.
