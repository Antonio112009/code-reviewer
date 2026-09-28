---
name: Async concurrency and throughput
description: Sequential awaits of independent work, unbounded Promise.all fan-out, concurrency limiters that limit nothing, overlapping setInterval jobs and synchronous microtask floods.
priority: 55
activation:
  content:
    - '\bfor\s*\(\s*(?:const|let)\s[^)\n]{1,80}\sof\s[^\n]{1,120}\n?[^\n]{0,120}\bawait\s'
    - '\bPromise\.all(?:Settled)?\s*\(\s*[\w$.]+\.map\s*\('
    - '\b(?:p-limit|pLimit|p-map|pMap|p-queue|PQueue|Bottleneck|limiter)\b'
    - '\bsetInterval\s*\(\s*async\b'
  examples:
    - 'for (const id of ids) await fetchItem(id);'
    - 'await Promise.all(items.map(callApi));'
    - 'const limit = pLimit(5);'
    - 'setInterval(async () => { await poll(); }, 1000);'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all
  - https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Async_JS/Promises#combining_multiple_promises
  - https://nodejs.org/api/timers.html#setintervalcallback-delay-args
---
- **Sequential independent awaits**: `for (const id of ids) await fetchItem(id)` or back-to-back awaits that don't depend on each other → latency adds up (N round trips). Fix: `Promise.all` with a concurrency cap, or a batch API.
- **Unbounded fan-out**: `await Promise.all(items.map(callApi))` over thousands of items → socket/file-descriptor exhaustion (`EMFILE`), DB pool starvation, rate-limit bans and memory spikes. Fix: `p-limit`/`p-map` with a limit, batches or streams.
- **Limiters that limit nothing**: handing a limiter already-started promises (`limit(fetch(url))`, or mapping `fetchItem` over all items before batching) or creating a new limiter per request → every call still runs at once. Fix: pass thunks (`limit(() => fetch(url))`); one shared limiter per resource.
- **Overlapping intervals**: `setInterval(async () => …)` starts the next run even if the previous one is still pending → concurrent duplicate jobs and pile-ups under slowness. Fix: schedule the next run with `setTimeout` after completion, or an in-flight guard.
- **Microtask floods**: long loops of `await` on already-resolved values or huge synchronous promise chains keep the thread busy between I/O turns → event-loop lag and UI jank. Fix: yield periodically (`setImmediate` in Node, `setTimeout` or feature-detected `scheduler.yield()` in browsers) or chunk the work.
