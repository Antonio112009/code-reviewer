---
name: Worker threads
description: A Worker per task instead of a pool, unhandled worker errors and exits, structured-clone and transfer surprises, SharedArrayBuffer races, and per-thread env, singletons and process.exit.
priority: 55
activation:
  content:
    - '\bworker_threads\b|\bpiscina\b'
    - '\bnew\s+Worker\s*\('
    - '\b(?:parentPort|workerData|isMainThread|receiveMessageOnPort)\b'
    - '\bSharedArrayBuffer\b|\bAtomics\.\w+\s*\(|\btransferList\b'
  examples:
    - 'const { Worker } = require("node:worker_threads");'
    - 'const worker = new Worker("./task.js");'
    - 'parentPort.postMessage(result);'
    - 'const counter = new SharedArrayBuffer(4);'
sources:
  - https://nodejs.org/api/worker_threads.html
  - https://nodejs.org/api/worker_threads.html#considerations-when-cloning-objects-with-prototypes-classes-and-accessors
  - https://nodejs.org/api/worker_threads.html#event-error
---
- **Worker per task**: creating a `Worker` per request or job costs a new V8 isolate (tens of ms, several MB) → throughput collapses under load. Fix: a fixed pool (e.g. piscina) sized to the CPU cores.
- **Errors and exits unhandled**: an uncaught exception in the worker emits `'error'`; when a worker dies, callers awaiting its `'message'` wait forever. Fix: reject pending tasks on `'error'` and on `'exit'` with a non-zero code; replace the worker.
- **Clone and transfer semantics**: messages and `workerData` are structured-cloned - class instances lose prototypes, functions throw `DataCloneError`, Buffers arrive as plain `Uint8Array`; a transferred `ArrayBuffer` is detached in the sender (length 0 afterwards). Fix: send plain data; copy before transferring.
- **Shared memory races**: plain reads/writes on `SharedArrayBuffer` views race between threads; `Atomics.wait` on the main thread blocks the event loop. Fix: `Atomics` operations; `Atomics.waitAsync` on the main thread.
- **Per-thread state**: each worker has its own `process.env` copy (unless `SHARE_ENV`), its own module singletons (DB pools → N× connections), and `process.exit()` there ends only that thread. Fix: pass config explicitly; size pools per worker.
