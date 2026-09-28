---
name: Virtual threads (JDK 21+)
description: Virtual-thread defects — pooling them, unbounded fan-out overwhelming downstream pools, carrier pinning in synchronized blocks on JDK 21–23, per-thread ThreadLocal caches, CPU-bound work, daemon-thread exits and preview-only structured concurrency.
priority: 66
tags: [CWE-400, CWE-833]
activation:
  content:
    - '\bnew(?:VirtualThreadPerTask|ThreadPerTask)Executor\('
    - '\bThread\.(?:ofVirtual|startVirtualThread)\('
    - '\b(?:StructuredTaskScope|ScopedValue)\b'
  examples:
    - 'ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor();'
    - 'Thread.ofVirtual().start(this::handle);'
    - 'try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {'
  versions: { lang.java: ">=21" }
sources:
  - https://openjdk.org/jeps/444
  - https://openjdk.org/jeps/491
  - https://openjdk.org/jeps/506
  - https://openjdk.org/jeps/533
---
- **Pooling virtual threads**: fixed pools of virtual threads add nothing but an accidental concurrency cap. Fix: one virtual thread per task; limit scarce resources with a `Semaphore`.
- **Unbounded fan-out**: `newVirtualThreadPerTaskExecutor()` over large inputs opens thousands of DB/HTTP calls at once → pool exhaustion, timeouts, overloaded dependencies. Fix: `Semaphore` or bounded batches.
- **Pinning (JDK 21–23)**: blocking I/O or `Object.wait()` inside `synchronized` pins the carrier → throughput collapse or deadlock; JDK 24 fixes monitors (JEP 491), native frames and class initializers still pin. Fix: `ReentrantLock` around blocking code on 21–23.
- **ThreadLocal caches**: per-thread buffers, formatters or clients are rebuilt for every short-lived virtual thread → allocation and memory spikes. Fix: shared thread-safe instances; `ScopedValue` (final in JDK 25) for context.
- **CPU-bound work**: long computations on virtual threads monopolize carriers. Fix: platform-thread pools for CPU work.
- **Daemon threads**: virtual threads are always daemon → work started from `main` with no other live thread lets the JVM exit mid-task. Fix: join/await the tasks.
- **Pinning diagnostics**: `-Djdk.tracePinnedThreads` was removed in JDK 24. Fix: JFR `jdk.VirtualThreadPinned` events.
- **Structured concurrency is preview**: `StructuredTaskScope` is still preview through JDK 27 (seventh preview) → needs `--enable-preview` and its API changes between releases. Fix: keep it out of libraries or pin the JDK.
