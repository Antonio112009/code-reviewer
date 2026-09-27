---
name: Structured concurrency
description: Coroutines that escape their owner — GlobalScope and ad-hoc CoroutineScope objects, Job/SupervisorJob passed to builders, NonCancellable used with launch/async, fire-and-forget work from suspend functions and async results never awaited.
priority: 66
tags: [CWE-404, CWE-772]
activation:
  content:
    - '\bGlobalScope\b'
    - '\bCoroutineScope\s*\('
    - '\b(?:launch|async)\s*\(\s*(?:Job|SupervisorJob|NonCancellable)\b'
    - '\b(?:launch|async)\s*\([^)\n]{0,80}\b(?:Job|SupervisorJob)\s*\('
    - '\b(?:MainScope|supervisorScope|coroutineScope)\s*[({]'
    - '\.(?:launch|async)\s*[({]'
    - '\blaunchIn\s*\('
sources:
  - https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/launch.html
  - https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-coroutine-scope/
  - https://github.com/Kotlin/kotlinx.coroutines/blob/master/CHANGES.md
  - https://developer.android.com/kotlin/coroutines/coroutines-best-practices
---
- **GlobalScope / stray scopes**: `GlobalScope.launch` or a `CoroutineScope(Dispatchers.IO)` created per call/object and never `cancel()`ed → work outlives the screen, request or bean; leaks, writes after logout. Fix: an owned, cancelled scope (`viewModelScope`, `lifecycleScope`, injected application scope).
- **Job in builder context**: `launch(Job())`, `async(SupervisorJob())` or `withContext(SupervisorJob())` replaces the parent → no cancellation from the scope, `coroutineScope {}` doesn't wait, failures bypass the parent (deprecated by lint in 1.11). Fix: `supervisorScope {}` or a scope built with `SupervisorJob()`.
- **NonCancellable builders**: `launch(NonCancellable)`/`async(NonCancellable)` detach the child the same way. Fix: only `withContext(NonCancellable)` for short cleanup.
- **Fire-and-forget in suspend functions**: a `suspend fun` that `launch`es into an outer scope returns before the work finishes → callers observe incomplete state; errors go unseen. Fix: `coroutineScope { … }`, or return the `Job` and `join()` it.
- **async never awaited**: `async {}` whose `Deferred` is dropped still fails its parent scope but loses the result; under a supervisor its exception is silently lost. Fix: `launch` for side effects; `await()` every `async`.
