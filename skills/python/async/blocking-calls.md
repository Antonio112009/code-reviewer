---
name: Blocking the event loop
description: Sync I/O, CPU-heavy work and sync waits inside coroutines, nested asyncio.run/run_until_complete, the bounded default executor, un-awaited coroutines and sync decorators wrapping async functions.
priority: 66
activation:
  content:
    - "\\btime\\.sleep\\s*\\(|\\brequests\\.\\w+\\s*\\(|\\burlopen\\s*\\(|\\bsubprocess\\.(?:run|call|check_\\w+)\\s*\\("
    - "\\b(?:psycopg2|pymysql|MySQLdb|pymongo|boto3|sqlite3)\\b|\\bredis\\.(?:Redis|StrictRedis)\\s*\\("
    - "\\b(?:bcrypt\\.hashpw|hashlib\\.(?:scrypt|pbkdf2_hmac)|checkpw)\\s*\\(|\\.result\\s*\\(\\s*\\)|\\bconcurrent\\.futures\\.wait\\s*\\("
    - "\\b(?:asyncio\\.run|run_until_complete|anyio\\.run|trio\\.run)\\s*\\(|\\bnest_asyncio\\b"
    - "\\b(?:to_thread|run_in_executor|run_sync)\\s*\\("
sources:
  - https://docs.python.org/3/library/asyncio-dev.html#running-blocking-code
  - https://docs.python.org/3/library/asyncio-dev.html#detect-never-awaited-coroutines
  - https://docs.python.org/3/library/asyncio-task.html#asyncio.to_thread
  - https://docs.python.org/3/library/concurrent.futures.html#threadpoolexecutor
---
- **Blocking I/O in coroutines**: `time.sleep`, `requests`, `urlopen`, sync DB drivers (psycopg2, pymysql, pymongo, sync redis, boto3) or `subprocess.run` inside `async def` freeze the event loop → every request stalls. Fix: async libraries or `asyncio.to_thread`.
- **CPU-bound work**: password hashing (bcrypt, scrypt), image processing or big pandas/JSON work in a coroutine blocks all tasks. Fix: a process pool via `run_in_executor`.
- **Sync waits**: `future.result()`, `threading.Lock.acquire()`, `Event.wait()` or `queue.Queue.get()` in a coroutine block the loop — and deadlock if that work needs the loop. Fix: `await asyncio.wrap_future(f)`, asyncio primitives.
- **Nested loops**: `asyncio.run()`, `run_until_complete()` or `anyio.run()` inside a running loop raise RuntimeError; `nest_asyncio` hides re-entrancy bugs. Fix: make the chain async; `run_coroutine_threadsafe` from threads.
- **Bounded offload**: `to_thread` and `run_in_executor(None, …)` share one default executor (`min(32, cpus + 4)` threads) → slow calls queue up, and cancelling the await doesn't stop the thread. Fix: a dedicated executor; timeouts inside the call.
- **Un-awaited coroutines**: calling an `async def` without `await` only creates a coroutine ("was never awaited") → writes and notifications silently skipped. Fix: `await` it or keep a task reference.
- **Sync decorators on async functions**: retry, timing or `try/except` decorators written for sync code wrap only coroutine creation → exceptions escape the retry. Fix: async-aware decorators.
