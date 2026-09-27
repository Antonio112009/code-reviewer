---
name: CompletableFuture pipelines
description: CompletableFuture defects — async stages on the shared common pool, silently dropped failures, cancel/orTimeout not stopping work, wrapped exceptions, thenApply nesting, callbacks on the completing thread and allOf result handling.
priority: 63
tags: [CWE-400, CWE-755]
activation:
  content:
    - '\bCompletableFuture\b'
    - '\bCompletionStage\b'
    - '\.(?:supplyAsync|runAsync|thenApply|thenApplyAsync|thenCompose|thenAccept|thenCombine|allOf|anyOf|orTimeout|completeOnTimeout|exceptionally|handle|whenComplete)\('
sources:
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ForkJoinPool.html#commonPool()
---
- **Common pool**: `supplyAsync`/`runAsync`/`*Async` without an executor run on `ForkJoinPool.commonPool()` (about cores − 1 threads, shared with parallel streams) → blocking I/O starves the JVM. Fix: pass a dedicated `Executor`.
- **Unobserved failures**: futures whose exceptional completion is never joined or handled (`exceptionally`, `handle`, `whenComplete`) → errors disappear silently. Fix: handle or log at the end of every chain.
- **Cancellation doesn't stop work**: `cancel(true)` never interrupts the running task, and `orTimeout`/`completeOnTimeout` (JDK 9+) only complete the future → the work keeps running. Fix: cancel the underlying operation (client timeouts, interruptible tasks).
- **Wrapped exceptions**: `join()` throws `CompletionException` and `get()` throws `ExecutionException` → `catch (MyException e)` never matches. Fix: unwrap `getCause()`.
- **Nested futures**: returning a `CompletableFuture` from `thenApply` yields `CompletableFuture<CompletableFuture<T>>` whose inner stage is never awaited. Fix: `thenCompose`.
- **Callback thread**: non-async stages (`thenApply`, `thenAccept`) run on whichever thread completes the future, e.g. an HTTP client or event-loop thread → blocking there stalls it. Fix: `*Async` variants with an executor.
- **allOf**: completes with `Void` only after every input finishes, even when one failed early → results and failures must be read from each input future. Fix: join each input after `allOf`.
