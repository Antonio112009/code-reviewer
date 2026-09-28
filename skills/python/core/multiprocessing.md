---
name: Multiprocessing and process pools
description: multiprocessing/ProcessPoolExecutor traps — start-method assumptions (forkserver default on POSIX since 3.14), missing __main__ guard, unpicklable tasks, Pool context manager terminate(), queue join deadlocks, broken pools and per-task overhead.
priority: 58
activation:
  content:
    - "\\bmultiprocessing\\b|\\bProcessPoolExecutor\\b|\\bmp_context\\s*="
    - "(?<![\\w.])(?:Pool|Process)\\s*\\("
    - "\\b(?:set_start_method|get_context|set_forkserver_preload)\\s*\\("
  examples:
    - 'with ProcessPoolExecutor() as pool:'
    - 'p = Process(target=worker)'
    - 'multiprocessing.set_start_method("spawn")'
sources:
  - https://docs.python.org/3/library/multiprocessing.html#contexts-and-start-methods
  - https://docs.python.org/3/library/multiprocessing.html#multiprocessing-programming
  - https://docs.python.org/3/library/multiprocessing.html#module-multiprocessing.pool
  - https://docs.python.org/3/library/concurrent.futures.html#processpoolexecutor
---
- **Start-method assumptions**: Linux used "fork" until 3.13; since 3.14 POSIX defaults to "forkserver" (macOS/Windows "spawn") → code relying on inherited globals, connections or monkeypatches fails with NameError/PicklingError. Fix: pass state explicitly; choose the context explicitly.
- **Missing `__main__` guard**: spawn/forkserver re-import the main module in every child → process creation at import time raises RuntimeError or recurses. Fix: `if __name__ == "__main__":`.
- **Unpicklable work**: lambdas, nested functions and bound methods of objects holding locks, sockets or clients can't reach workers → PicklingError. Fix: module-level functions; create clients in `initializer=`.
- **`with Pool()` terminates**: `Pool.__exit__` calls `terminate()` → pending `apply_async`/`map_async` results are lost. Fix: `close()` + `join()`, or `.get()` results inside the block.
- **Queue join deadlock**: joining a process before draining the `multiprocessing.Queue` it wrote to hangs. Fix: consume all items first.
- **Broken pools**: one crashed or OOM-killed worker fails every pending future with `BrokenProcessPool`. Fix: handle it; `max_tasks_per_child`.
- **Per-task overhead**: `ProcessPoolExecutor.map` defaults to `chunksize=1` and reads the whole input up front (`buffersize` from 3.14). Fix: larger `chunksize`, batched input.
- **Copied state**: globals mutated in a child are invisible to the parent. Fix: return results or use a `Manager`/database.
