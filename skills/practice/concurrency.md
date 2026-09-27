---
name: Concurrency
description: Races and lost updates, write skew, orphaned tasks, shared state, lock misuse, unbounded fan-out, lost cancellation, racy lazy init and single-instance assumptions in concurrent code.
category: practice
priority: 58
tier: essential
tags:
  - CWE-362
  - CWE-367
  - CWE-667
  - CWE-833
  - CWE-488
  - CWE-770
activation:
  languages:
    - typescript
    - javascript
    - python
    - php
    - java
    - kotlin
    - csharp
    - go
    - rust
    - c
    - cpp
    - ruby
    - swift
    - scala
    - dart
    - elixir
    - objective-c
    - vue
    - svelte
    - groovy
    - sql
  content:
    - \bPromise\.(?:all|allSettled|race|any)\(|\bnew Worker\(|\bworker_threads\b|\bAtomics\.|\bSharedArrayBuffer\b|\bAsyncLocalStorage\b
    - \basyncio\.(?:gather|create_task|TaskGroup|Lock|Semaphore|wait|to_thread)\b|\b(?:threading|multiprocessing|concurrent\.futures|contextvars)\b|\b(?:Thread|Process)PoolExecutor\b
    - \b(?:Mutex|RWMutex|RwLock|Semaphore|SemaphoreSlim|ReentrantLock|ReadWriteLock|CountDownLatch|ConcurrentHashMap|AtomicInteger|AtomicLong|AtomicReference|ThreadLocal|WaitGroup|errgroup|Interlocked)\b|\bsync\.Once\b
    - \bsynchronized\b|\bvolatile\b|\block\s*\(\s*\w|\b(?:ExecutorService|CompletableFuture|parallelStream|ConfigureAwait)\b|\bExecutors\.\w|\bTask\.(?:Run|WhenAll|WhenAny)\b|\bParallel\.For
    - \bgo\s+(?:func\s*\(|[A-Za-z_][\w.]*\()|\bmake\(\s*chan\b|\bselect\s*\{[ \t]*\n[^\n]{0,120}\bcase\b
    - \btokio::(?:spawn|select!|join!|sync|task)|\b(?:spawn_blocking|block_on)\b|\bthread::spawn\b|\brayon::|\b(?:GlobalScope|runBlocking|coroutineScope|supervisorScope)\b|\blaunch\s*\{
    - "@MainActor\\b|\\bDispatchQueue\\b|\\bTask\\.detached\\b|\\bTask\\s*\\{|\\bactor\\s+[A-Z]\\w*|@Sendable\\b|\\bnonisolated\\b"
    - \b(?:get_or_create|update_or_create|findOrCreate|firstOrCreate|updateOrCreate|FirstOrCreate|select_for_update|lockForUpdate|with_lock|SKIP LOCKED|FOR UPDATE|FOR SHARE|SERIALIZABLE|OptimisticLock\w*|PESSIMISTIC_WRITE)\b|\bfor update\b(?=\s*(?:of\b|nowait\b|skip\b|["'`;)]|$))|@Version\b
    - "@Scheduled\\b|\\bcron\\.schedule\\(|\\bnew CronJob\\(|\\bschedule\\.every\\(|\\b(?:Background|AsyncIO)Scheduler\\b|\\bsetInterval\\([^\\n]{0,80}\\b(?:db|query|fetch|send|sync|process)\\w*"
---
- **Check-then-act**: exists-then-insert, get-or-create, read-modify-write of counters, or lazy init (`if (!x) x = await make()`) without unique key, atomic update or once-guard → duplicates, lost updates. Fix: upsert, atomic increments, cache the promise.
- **Write skew**: invariant across rows ("one active plan", "no overlapping bookings") checked then written under READ COMMITTED or snapshot isolation → both transactions pass. Fix: `SERIALIZABLE` + retry, exclusion constraint, lock a parent row.
- **Orphaned tasks**: promise, `create_task`, goroutine, `Task.Run` or `launch` without await, join or owning scope → lost errors, work cut at shutdown; unreferenced asyncio tasks may be garbage-collected. Fix: `TaskGroup`, `errgroup`.
- **Shared mutable state**: per-request data in module, static or singleton fields; non-thread-safe maps, lists or formatters mutated concurrently → cross-user leaks, corruption, fatal Go "concurrent map writes". Fix: request scope, locks.
- **Lock misuse**: lock held across `await`, I/O or callbacks; inconsistent lock order; a new lock object per call; unlock skipped on error → deadlock or no exclusion. Fix: short sections, fixed order, `defer`/`finally`.
- **Fan-out**: `Promise.all`, `gather` or a goroutine per item of unbounded input → exhausted sockets, pools and rate limits, and after the first rejection siblings keep writing (half-applied batch). Fix: bounded concurrency; `allSettled` or cancel siblings.
- **Lost cancellation**: `Context`, `AbortSignal` or `CancellationToken` not passed downstream; `CancelledError` or `InterruptedException` caught and ignored → work outlives timeouts, shutdown hangs. Fix: propagate, rethrow.
- **Single-instance assumptions**: in-process locks, schedulers, rate limiters or counters that must be global while several replicas or workers run → duplicate jobs, per-pod limits. Fix: DB/Redis lock with expiry, leader election.
- **Context bleed**: `ThreadLocal`, MDC, `AsyncLocalStorage` or contextvars not cleared on pooled threads, or not propagated into executors and callbacks → another request's user or tenant used. Fix: clear in `finally`, context-aware executors.
