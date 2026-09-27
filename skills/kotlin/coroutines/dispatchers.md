---
name: Dispatchers and blocking
description: Thread misuse in coroutines — blocking calls on Main/Default or engine threads, runBlocking inside coroutines or on the main thread, Dispatchers.IO limits and elastic limitedParallelism views, leaked single-thread contexts and Unconfined resuming on arbitrary threads.
priority: 64
tags: [CWE-400, CWE-833]
activation:
  content:
    - '\brunBlocking\b'
    - '\bDispatchers\.(?:IO|Default|Main|Unconfined)\b'
    - '\blimitedParallelism\s*\('
    - '\bnew(?:SingleThread|FixedThreadPool)Context\s*\('
    - '\basCoroutineDispatcher\s*\('
    - '\bwithContext\s*\('
    - '\bThread\.sleep\s*\('
sources:
  - https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/run-blocking.html
  - https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-dispatchers/-i-o.html
  - https://kotlinlang.org/docs/coroutine-context-and-dispatchers.html
  - https://developer.android.com/kotlin/coroutines/coroutines-best-practices#main-safe
---
- **Blocking on the wrong dispatcher**: JDBC, file/network I/O, `Thread.sleep` or heavy parsing on `Dispatchers.Main`/`viewModelScope` (Main.immediate), `Default` or server event-loop threads → ANR, starved CPU pool, stalled requests. Fix: `withContext(Dispatchers.IO)` inside the suspend function (main-safe).
- **runBlocking in coroutines**: `runBlocking` inside a `suspend fun` or coroutine blocks the carrier thread and ignores the caller's context; on a small pool or Main it can deadlock. Fix: call the suspend function directly.
- **runBlocking on main/request threads**: Android main thread (ANR) or servlet/Netty threads waiting on network → thread exhaustion. Fix: launch in an owned scope or make the entry point suspend.
- **IO pool limits**: `Dispatchers.IO` runs at most 64 blocking tasks, so slow calls queue the rest; its `limitedParallelism(n)` views are elastic, not bounded by that limit → hundreds of threads. Fix: size views to the backing resource.
- **Leaked thread contexts**: `newSingleThreadContext`/`newFixedThreadPoolContext`/`Executors…asCoroutineDispatcher()` created per use and never `close()`d → thread leaks. Fix: share one instance and close it, or `Dispatchers.Default.limitedParallelism(1)`.
- **Unconfined**: `Dispatchers.Unconfined` resumes on whatever thread completed the suspension → UI touched off the main thread, thread-confined objects shared. Fix: a real dispatcher.
