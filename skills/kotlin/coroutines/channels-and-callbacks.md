---
name: Channels and callback bridges
description: Bridging callbacks and channels into coroutines — resuming a continuation twice, missing invokeOnCancellation/awaitClose, ignored trySend failures, channels never closed, consumeAsFlow collected twice, unlimited buffers and elements lost on cancellation.
priority: 64
tags: [CWE-401, CWE-404, CWE-770]
activation:
  content:
    - '\bsuspend(?:Cancellable)?Coroutine\s*[<{(]'
    - '\binvokeOnCancellation\b'
    - '\b(?:callbackFlow|channelFlow)\s*[<{(]'
    - '\bawaitClose\b'
    - '\btrySend(?:Blocking)?\s*\('
    - '\bChannel\s*<'
    - '\bChannel\s*\('
    - '\bproduce\s*[<{(]'
    - '\b(?:consumeAsFlow|receiveAsFlow|consumeEach)\s*[({]'
sources:
  - https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/suspend-cancellable-coroutine.html
  - https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/callback-flow.html
  - https://kotlinlang.org/docs/channels.html
  - https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.channels/-channel/
---
- **Double resume**: a callback that can fire twice (success then error, retries) calling `cont.resume(...)` again → `IllegalStateException`. Fix: resume once (`if (cont.isActive)`), unregister after the first result.
- **No cancellation hook**: `suspendCancellableCoroutine` without `invokeOnCancellation { call.cancel() / unregister }`, or plain `suspendCoroutine` → the request/listener outlives the cancelled caller. Fix: register cleanup; closeable results via `resume(value) { _, v, _ -> v.close() }`.
- **callbackFlow without awaitClose**: the block returns → `IllegalStateException` at runtime and the listener never unregisters. Fix: end with `awaitClose { api.unregister(callback) }` (register/unregister must be thread-safe).
- **Ignored trySend**: `trySend` in callbacks fails when the default 64-element buffer is full or the channel closed → events dropped silently. Fix: check the result; `buffer(Channel.CONFLATED/UNLIMITED)` deliberately.
- **Channel never closed**: a producer that returns without `close()` leaves `for (x in channel)` consumers suspended forever. Fix: `produce {}` (closes on completion) or `close()` in `finally`.
- **consumeAsFlow twice**: collecting a `consumeAsFlow()` flow a second time throws `IllegalStateException`; `consumeEach` cancels the channel for other consumers. Fix: `receiveAsFlow()` or a plain `for` loop for fan-out.
- **Unbounded buffers**: `Channel(UNLIMITED)` fed faster than consumed → memory growth to OOM. Fix: bounded capacity with `BufferOverflow` policy.
