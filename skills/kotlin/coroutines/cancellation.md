---
name: Cancellation and timeouts
description: Broken coroutine cancellation — swallowed CancellationException, non-cooperative loops and blocking calls, suspending cleanup without NonCancellable, withTimeout that silently ends a launch or keeps running blocking code, and resources lost when a result arrives after cancellation.
priority: 68
tags: [CWE-400, CWE-404, CWE-755]
activation:
  content:
    - '\brunCatching\s*\{'
    - '\bcatch\s*\(\s*\w+\s*:\s*(?:Throwable|Exception|CancellationException)\s*\)'
    - '\bwithTimeout(?:OrNull)?\s*\('
    - '\bNonCancellable\b'
    - '\b(?:ensureActive|isActive|yield|runInterruptible)\b'
    - '\bThread\.sleep\s*\('
    - '\bwhile\s*\(\s*true\s*\)'
    - '\bfinally\s*\{'
sources:
  - https://kotlinlang.org/docs/cancellation-and-timeouts.html
  - https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/with-timeout.html
  - https://developer.android.com/kotlin/coroutines/coroutines-best-practices#exceptions
---
- **Swallowed cancellation**: `runCatching {}`, `catch (e: Exception)` or `catch (e: Throwable)` around suspend calls also catch `CancellationException` → cancelled work keeps running, retries loop after the scope died. Fix: rethrow it (`if (e is CancellationException) throw e`) or `currentCoroutineContext().ensureActive()`.
- **Non-cooperative loops**: CPU loops or `while (true)` without a suspension point never observe cancellation. Fix: `ensureActive()`/`yield()` per iteration.
- **Blocking calls**: `Thread.sleep`, blocking I/O or JDBC inside a coroutine ignore cancellation and `withTimeout` (it fires but the block runs to completion). Fix: `delay`, suspending APIs, or `runInterruptible(Dispatchers.IO) { … }`.
- **Timeout is not an error**: an uncaught `TimeoutCancellationException` inside `launch` just cancels that coroutine; the parent scope completes normally → timeouts vanish silently. Fix: `withTimeoutOrNull(...) ?: error("timed out")` or catch it explicitly.
- **Suspending cleanup**: `finally { repo.release() }` calling suspend functions in a cancelled coroutine throws immediately → cleanup skipped. Fix: `withContext(NonCancellable) { … }` in `finally`.
- **Lost results**: a closeable opened inside `withContext`/`withTimeout` and returned is discarded if the caller is cancelled meanwhile (prompt cancellation) → leaked file/connection. Fix: store it in a variable closed in `finally`, or open it outside.
