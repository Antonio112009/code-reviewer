---
name: Event loops and threads
description: get_event_loop() without a running loop (warning 3.12, RuntimeError 3.14), deprecated policies (3.14), loop-bound primitives reused across loops, calls from other threads, a new loop per call, signal handlers and default-executor shutdown.
priority: 62
activation:
  content:
    - "\\bget_event_loop(?:_policy)?\\s*\\(|\\bnew_event_loop\\s*\\(|\\bset_event_loop(?:_policy)?\\s*\\(|\\bEventLoopPolicy\\b"
    - "\\brun_until_complete\\s*\\(|\\basyncio\\.run\\s*\\(|\\bRunner\\s*\\(|\\bloop_factory\\b"
    - "\\brun_coroutine_threadsafe\\s*\\(|\\bcall_soon(?:_threadsafe)?\\s*\\(|\\brun_in_executor\\s*\\("
    - "\\basyncio\\.(?:Lock|Event|Queue|Semaphore|Condition|Barrier)\\s*\\(|\\badd_signal_handler\\s*\\("
sources:
  - https://docs.python.org/3/whatsnew/3.14.html#asyncio
  - https://docs.python.org/3/library/asyncio-dev.html#concurrency-and-multithreading
  - https://docs.python.org/3/library/asyncio-runner.html#asyncio.run
  - https://github.com/python/cpython/blob/main/Lib/asyncio/mixins.py
---
- **`get_event_loop()` outside a loop**: warns since 3.12 and raises RuntimeError in 3.14 when no loop is set (no implicit creation) → startup code, CLIs and tests crash on upgrade. Fix: `asyncio.run()`/`Runner`; `get_running_loop()` in coroutines.
- **Policies deprecated (3.14)**: `set_event_loop_policy` and the `*EventLoopPolicy` classes are slated for removal in 3.16. Fix: `asyncio.run(main(), loop_factory=...)`.
- **Loop-bound primitives**: `asyncio.Lock`/`Event`/`Queue`/`Semaphore` bind to the first loop that uses them (3.10+) → module-level instances reused across `asyncio.run()` calls, test loops or threads raise "bound to a different event loop". Fix: create them inside the running loop.
- **Calls from other threads**: asyncio objects aren't thread-safe; `call_soon`, `task.cancel()`, `fut.set_result()` or `queue.put_nowait()` from a thread corrupt state or never wake the loop. Fix: `call_soon_threadsafe()`/`run_coroutine_threadsafe()`.
- **A loop per call**: sync wrappers running `asyncio.run()` per call break clients bound to another loop (aiohttp sessions, async DB pools). Fix: one long-lived loop per thread.
- **Signals**: `loop.add_signal_handler` is Unix-only and must run in the main thread. Fix: register at startup; handle Windows separately.
- **Executor shutdown**: `asyncio.run()` waits up to 5 minutes for default-executor threads still blocked at exit → hung shutdowns. Fix: timeouts inside blocking calls.
