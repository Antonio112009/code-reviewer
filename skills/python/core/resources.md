---
name: Resource lifetimes
description: Files, sockets, connections, temp files and locks that outlive their use — open() outside with, @contextmanager without try/finally, sqlite3 connection context managers that never close, mkstemp/mkdtemp leftovers, __del__ cleanup and manual acquire().
priority: 58
tags: [CWE-404, CWE-772]
activation:
  content:
    - "=\\s*(?:open|io\\.open|gzip\\.open|bz2\\.open|lzma\\.open|codecs\\.open)\\s*\\("
    - "@(?:contextlib\\.)?contextmanager\\b"
    - "\\bsqlite3\\.connect\\s*\\("
    - "\\b(?:mkstemp|mkdtemp|NamedTemporaryFile|TemporaryDirectory|SpooledTemporaryFile)\\s*\\("
    - "\\bdef\\s+__del__\\s*\\(|\\bweakref\\.finalize\\b"
    - "\\.acquire\\s*\\(|\\bflock\\s*\\("
    - "=\\s*(?:socket\\.socket|socket\\.create_connection|zipfile\\.ZipFile|tarfile\\.open)\\s*\\("
sources:
  - https://docs.python.org/3/library/contextlib.html#contextlib.contextmanager
  - https://docs.python.org/3/library/sqlite3.html#sqlite3-connection-context-manager
  - https://docs.python.org/3/library/tempfile.html
  - https://docs.python.org/3/reference/datamodel.html#object.__del__
---
- **Handles outside `with`**: `f = open(...)`, sockets, `ZipFile`, `tarfile.open` or connections not closed in `finally` → fd leaks, truncated writes, files locked on Windows. Fix: `with` or `contextlib.closing()`.
- **`@contextmanager` without try/finally**: body exceptions are re-raised at `yield`, so cleanup after a bare `yield` is skipped; catching without re-raising hides the error. Fix: `try: yield x` / `finally: cleanup()`.
- **`with sqlite3.connect()`**: the context manager only commits/rolls back and never closes → leaked connections, "database is locked". Fix: `contextlib.closing(sqlite3.connect(p))` or `close()`.
- **Temp files**: `mkstemp()` returns an open fd and a file nobody deletes; `mkdtemp()` dirs persist; `NamedTemporaryFile()` can't be reopened by name on Windows while open. Fix: `TemporaryDirectory`, cleanup in `finally`, `delete_on_close=False` (3.12+).
- **Cleanup in `__del__`**: finalizers run whenever GC gets there (maybe another thread), not reliably at exit, and their exceptions are only printed → transactions left open. Fix: explicit `close()`; `weakref.finalize` as backstop.
- **Manual `acquire()`**: `lock.acquire()`/`flock()` without `try/finally: release()` stays locked after an exception → deadlock. Fix: `with lock:`.
- **Abandoned generators**: a generator holding an open file/cursor and left after `break` keeps it open until GC. Fix: open it outside, or `closing(gen)`.
