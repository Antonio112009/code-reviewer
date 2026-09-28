---
name: Coroutine exception propagation
description: Where coroutine exceptions really go — try/catch around launch, CoroutineExceptionHandler on non-root coroutines, async failing its parent before await, supervisor children without handlers and uncaught failures crashing Android apps.
priority: 66
tags: [CWE-248, CWE-755]
activation:
  content:
    - '\bCoroutineExceptionHandler\b'
    - '\bsupervisorScope\s*\{'
    - '\bSupervisorJob\s*\('
    - '\.(?:launch|async)\s*[({]'
    - '\b(?:launch|async)\s*\{'
    - '\.await(?:All)?\s*\('
    - '\binvokeOnCompletion\s*\{'
  examples:
    - 'val handler = CoroutineExceptionHandler { _, e -> log(e) }'
    - 'supervisorScope { launch { risky() } }'
    - 'val scope = CoroutineScope(SupervisorJob())'
    - 'viewModelScope.launch { fetchUser() }'
    - 'launch { fetchUser() }'
    - 'val result = deferred.await()'
    - 'job.invokeOnCompletion { cause -> log(cause) }'
sources:
  - https://kotlinlang.org/docs/exception-handling.html
  - https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/async.html
  - https://developer.android.com/kotlin/coroutines/coroutines-best-practices#exceptions
---
- **try/catch around launch**: `try { scope.launch { mayThrow() } } catch (…)` never sees the exception — it is thrown later inside the coroutine and goes to the parent/handler. Fix: catch inside the coroutine body.
- **Handler on a child**: a `CoroutineExceptionHandler` given to a nested `launch` or to `async` is never used — only root coroutines and direct supervisor children consult it → crash or silent loss. Fix: install it on the root scope.
- **async fails the parent early**: a failing `async` inside `coroutineScope`/non-supervisor scope cancels the parent and siblings immediately, even before `await()`; wrapping only `await()` in try/catch doesn't contain it. Fix: `supervisorScope`, or catch inside `async`.
- **Supervisor children**: children of `SupervisorJob`/`supervisorScope` don't propagate failures upward → each needs its own handling, otherwise the exception is uncaught (logged or crashing). Fix: try/catch inside each child or a handler on the scope.
- **Crash on Android**: an uncaught exception in `viewModelScope`/`lifecycleScope` (no handler) reaches the thread's uncaught-exception handler → app crash. Fix: catch expected failures (`IOException`, `HttpException`) in the coroutine and map to UI state.
- **First exception wins**: when several children fail, only the first exception propagates; the rest are attached as suppressed → hidden root causes if logs print only the message. Fix: log `suppressed` too.
