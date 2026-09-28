---
name: async def vs def execution
description: FastAPI execution-model defects — blocking I/O or CPU work in async def endpoints and dependencies that stalls every request, sync def handlers exhausting the 40-thread AnyIO pool, and sync work hidden in async-looking helpers.
priority: 66
tags: [CWE-400]
activation:
  content:
    - '@\w+\.(?:get|post|put|patch|delete|api_route|websocket)\('
    - '\basync\s+def\s+\w+\([^)\n]{0,200}\bDepends\('
    - '\b(?:run_in_threadpool|to_thread\.run_sync|asyncio\.to_thread|current_default_thread_limiter)\b'
  examples:
    - '@app.get("/items/{item_id}")'
    - 'async def get_item(item_id: int, db=Depends(get_db)):'
    - 'result = await run_in_threadpool(hash_password, raw_password)'
sources:
  - https://fastapi.tiangolo.com/async/
  - https://anyio.readthedocs.io/en/stable/threads.html
  - https://starlette.dev/threadpool/
---
- **Blocking inside async def**: `requests`, `time.sleep`, a sync DB `Session`, `boto3` or file I/O in an `async def` path operation or dependency runs on the event loop → all requests stall. Fix: async clients, or plain `def` (auto-offloaded).
- **Thread-pool exhaustion**: plain `def` endpoints and dependencies share AnyIO's default 40-thread limiter with `UploadFile`, `FileResponse` and sync background tasks; slow calls without timeouts queue all other sync work. Fix: timeouts, async I/O, or raise the limiter in `lifespan`.
- **Sync call wrapped wrongly**: `await run_in_threadpool(f())` or `asyncio.to_thread(f())` calls `f` on the loop first and passes its result. Fix: pass the callable: `run_in_threadpool(f, *args)`.
- **CPU-bound work in requests**: image processing, password hashing loops or large JSON transforms in either style tie up the loop or a pool thread for seconds. Fix: process pool or task queue.
- **Sync helper called from async code**: a `def` utility doing network or DB I/O invoked directly from an `async def` handler still blocks; only path operations and dependencies are auto-offloaded. Fix: `await run_in_threadpool(helper, ...)`.
