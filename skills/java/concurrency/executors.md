---
name: Executors, thread pools and ThreadLocal
description: Thread-pool defects — unbounded queues and threads from Executors factories, pools never shut down, exceptions swallowed by submit and periodic tasks, waits without timeouts, pool-starvation deadlocks and ThreadLocal leaks between tasks.
priority: 64
tags: [CWE-400, CWE-404, CWE-833]
activation:
  content:
    - '\bExecutors\.new\w+\('
    - '\b(?:ExecutorService|ScheduledExecutorService|ThreadPoolExecutor|ForkJoinPool|ExecutorCompletionService)\b'
    - '\.(?:submit|invokeAll|invokeAny|shutdown|shutdownNow)\('
    - '\.schedule(?:AtFixedRate|WithFixedDelay)?\('
    - '\bThreadLocal\b'
sources:
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ScheduledExecutorService.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ThreadLocal.html
---
- **Unbounded pools**: `newFixedThreadPool`/`newSingleThreadExecutor` queue without limit (memory growth, huge latency under load); `newCachedThreadPool` creates unlimited threads. Fix: `ThreadPoolExecutor` with a bounded queue and a rejection policy.
- **Never shut down**: an executor created per call or request leaks threads, and its non-daemon threads keep the JVM alive. Fix: one shared, lifecycle-managed executor; try-with-resources on JDK 19+.
- **Swallowed task exceptions**: `submit()` stores exceptions in a `Future` nobody reads (unlike `execute()`) → failures vanish. Fix: `execute`, or check `get()`/log inside the task.
- **Periodic task dies silently**: an exception thrown by a `scheduleAtFixedRate`/`scheduleWithFixedDelay` task suppresses all later runs. Fix: catch and log inside the task body.
- **Unbounded waits**: `future.get()`, `invokeAll` or `awaitTermination` without timeouts on request threads → hung requests. Fix: timed variants, cancel on timeout.
- **Pool-starvation deadlock**: tasks that submit subtasks to the same bounded pool and block on them → every thread waits. Fix: separate pools or non-blocking composition.
- **ThreadLocal leaks**: values set in pooled tasks without `remove()` in `finally` → the next task sees another user's data; redeploys leak classloaders. Fix: try/finally `remove()` or pass context explicitly.
