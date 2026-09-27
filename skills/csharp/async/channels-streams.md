---
name: Channels and async streams
description: System.Threading.Channels and IAsyncEnumerable defects — unbounded channels without backpressure, silently dropped items, writers never completed, wrong SingleReader/SingleWriter flags and async streams consumed without cancellation.
priority: 58
activation:
  content:
    - '\bChannel\.Create(?:Bounded|Unbounded)\b|\bChannel(?:Reader|Writer)<|\bBoundedChannel(?:Options|FullMode)\b'
    - '\bIAsyncEnumerable<|\bawait\s+foreach\b|\[EnumeratorCancellation\]|\bWithCancellation\('
    - '\.(?:TryWrite|ReadAllAsync|WaitToReadAsync|WaitToWriteAsync|TryComplete)\('
sources:
  - https://learn.microsoft.com/en-us/dotnet/core/extensions/channels
  - https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/generate-consume-asynchronous-stream
  - https://learn.microsoft.com/en-us/dotnet/api/system.threading.channels.boundedchannelfullmode
---
- **No backpressure**: `Channel.CreateUnbounded` fed faster than it's drained → memory grows until OOM. Fix: `CreateBounded` with `BoundedChannelFullMode.Wait`.
- **Silent drops**: `DropOldest`/`DropNewest`/`DropWrite` discard items without errors; `TryWrite` returns `false` when a `Wait`-mode channel is full — ignoring the bool loses messages. Fix: `await WriteAsync`, check results, count drops via the `itemDropped` callback.
- **Writer never completed**: a producer that finishes or throws without `Writer.Complete(ex)`/`TryComplete` → consumers in `ReadAllAsync`/`WaitToReadAsync` hang forever and the error disappears. Fix: complete in `finally`, passing the exception.
- **Wrong concurrency flags**: `SingleReader = true`/`SingleWriter = true` while several consumers/producers use the channel → the lock-free fast paths corrupt state. Fix: set them only when structurally guaranteed.
- **Streams without cancellation**: `await foreach` over an `IAsyncEnumerable` without `.WithCancellation(ct)`/passing the token to the iterator's `[EnumeratorCancellation]` parameter → producer keeps querying/streaming after the request ends. Fix: flow the token.
- **Consumer exceptions stop producers silently**: a faulted consumer loop leaves bounded writers blocked in `WriteAsync` forever. Fix: `Reader.Completion`/`TryComplete(ex)` on consumer failure and observe the producer task.
