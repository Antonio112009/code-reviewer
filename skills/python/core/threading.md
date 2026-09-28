---
name: Threads and thread pools
description: Thread-safety traps — GIL-reliant read-modify-write (worse on free-threaded 3.13t/3.14t), exceptions lost in executors, daemon threads at exit, threading.local in pools, fork with threads (3.12 warning), main-thread-only signals and queue.join hangs.
priority: 58
tags: [CWE-362, CWE-833]
activation:
  content:
    - "\\bthreading\\.\\w|(?<![\\w.])Thread\\s*\\(|\\bThreadPoolExecutor\\b|\\bconcurrent\\.futures\\b"
    - "(?<![\\w.])(?:R?Lock|Semaphore|Condition|Event|Barrier)\\s*\\(\\s*\\)"
    - "\\bos\\.fork\\s*\\(|\\bsignal\\.signal\\s*\\(|\\bcatch_warnings\\s*\\("
    - "\\bqueue\\.(?:Simple)?Queue\\s*\\(|\\.task_done\\s*\\(|\\bsys\\._is_gil_enabled\\b"
  examples:
    - 'executor = ThreadPoolExecutor(max_workers=4)'
    - 'lock = Lock()'
    - 'signal.signal(signal.SIGTERM, handler)'
    - 'q = queue.Queue()'
sources:
  - https://docs.python.org/3/library/threading.html#thread-objects
  - https://docs.python.org/3/library/concurrent.futures.html#future-objects
  - https://docs.python.org/3/howto/free-threading-python.html
  - https://docs.python.org/3/library/multiprocessing.html#contexts-and-start-methods
---
- **GIL is not a lock**: `counter += 1` or `if key not in d: d[key] = …` interleave between threads → lost updates; free-threaded builds (3.13t, 3.14t) make such races far more frequent. Fix: hold a `threading.Lock` for the sequence.
- **Lost worker exceptions**: exceptions in `executor.submit()` tasks stay in the Future until `.result()` is called; `Thread` targets only print a traceback → silent failures. Fix: `.result()` every future; `threading.excepthook`.
- **Daemon threads at exit**: killed abruptly at shutdown — no `finally`, flush or commit. Fix: non-daemon threads with a stop `Event` and `join()`.
- **`threading.local` in pools**: values set in pooled threads survive into the next task → another request's user or DB session reused. Fix: reset in `finally`, or `contextvars`.
- **`fork()` with threads**: `os.fork()`/"fork" start method in a threaded process copies held locks → child deadlocks (DeprecationWarning since 3.12). Fix: "spawn"/"forkserver".
- **Main-thread-only signals**: `signal.signal()` raises ValueError outside the main thread and handlers run only there → workers never see SIGTERM. Fix: register in main; stop workers via an `Event`.
- **Unsafe shared objects**: sqlite3 connections, generators and `warnings.catch_warnings()` (global filters) used from several threads. Fix: per-thread objects or a lock.
- **`queue.join()` hangs**: each `get()` needs `task_done()`, also on failure. Fix: call it in `finally`.
