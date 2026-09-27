---
name: Memory leaks
description: Unbounded module-level caches, listeners and timers never removed (MaxListenersExceededWarning), promises that never settle retaining closures, and small buffer views keeping large allocations alive.
priority: 55
tags: [CWE-401, CWE-770]
activation:
  content:
    - '^(?:export\s+)?(?:const|let)\s+\w*(?:cache|Cache|store|Store|registry|Registry|map|Map|seen|pending|queue)\w*\s*=\s*(?:new\s+(?:Map|Set)\b|\{\s*\}|\[\s*\])'
    - '\.(?:addListener|addEventListener)\s*\(|\.on\s*\(\s*[''"](?:connection|request|message|data|change)[''"]'
    - '\bsetMaxListeners\s*\(|\bsetInterval\s*\('
    - '\bnew\s+Promise\s*\('
    - '\.subarray\s*\('
sources:
  - https://nodejs.org/api/events.html#eventsdefaultmaxlisteners
  - https://nodejs.org/api/timers.html#timeoutunref
  - https://nodejs.org/api/buffer.html#bufsubarraystart-end
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Memory_management
---
- **Unbounded caches**: module-level `Map`s, objects or arrays keyed by user, request or query data that only grow (memoization, dedupe sets, "recent" lists) → heap grows until OOM in long-lived processes. Fix: LRU/TTL with a max size; `WeakMap` for object keys.
- **Listeners never removed**: `emitter.on`/`addEventListener`/`socket.on` registered per request or component without removal → leaks and duplicate handling; Node's `MaxListenersExceededWarning` (>10 per event) flags it and raising `setMaxListeners` only hides it. Fix: `once`, same-reference removal, `{ signal }`.
- **Timers kept alive**: intervals/timeouts that are never cleared keep their closures (and everything referenced) alive and, in Node, keep the process from exiting. Fix: `clearInterval` on teardown; `unref()` for background timers.
- **Promises that never settle**: waiting for an event or callback that never comes (no timeout) retains the whole async closure per request. Fix: timeouts/`AbortSignal` on every wait; reject on teardown.
- **Small views retaining big parents**: a `buf.subarray()`/`Buffer#slice` of a large upload or pooled buffer kept in a long-lived structure pins the entire parent allocation. Fix: copy what you keep (`Buffer.from(view)`).
