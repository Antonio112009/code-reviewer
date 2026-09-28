---
name: Process lifecycle, signals and crashes
description: What crashes or hangs a Node process - unhandled rejections and uncaught exceptions, emitter 'error' events and async listeners, process.exit truncating work, signal handlers, and process.env string coercion.
priority: 65
tags: [CWE-755, CWE-404]
activation:
  content:
    - '\bprocess\.(?:on|once|exit|exitCode|kill|abort)\b'
    - '\b(?:uncaughtException|unhandledRejection|SIGTERM|SIGINT|SIGHUP|beforeExit)\b'
    - '\.on\s*\(\s*[''"]error[''"]|\bcaptureRejections\b'
    - '\bnew\s+EventEmitter\b|\bextends\s+EventEmitter\b'
    - '\bprocess\.env\.\w+\s*=[^=]'
  examples:
    - 'process.on("uncaughtException", handleFatal);'
    - 'socket.on("error", (err) => logger.error(err));'
    - 'class Pipeline extends EventEmitter {}'
    - 'process.env.NODE_ENV = "production";'
sources:
  - https://nodejs.org/api/process.html#warning-using-uncaughtexception-correctly
  - https://nodejs.org/api/process.html#processexitcode
  - https://nodejs.org/api/process.html#signal-events
  - https://nodejs.org/api/events.html#error-events
---
- **Resuming after fatal errors**: `uncaughtException`/`unhandledRejection` handlers that only log and continue keep the process in an undefined state (half-done transactions, held locks); without a handler, one unhandled rejection exits the process (Node ≥15). Fix: log, clean up, exit non-zero, let the supervisor restart.
- **`process.exit()` cuts work short**: pending stdout/stderr writes (async on pipes), log flushes and in-flight requests or DB commits are dropped; `'beforeExit'` doesn't fire. Fix: set `process.exitCode` and let the loop drain after closing servers and pools.
- **Signal handlers**: adding a `SIGTERM`/`SIGINT` listener removes Node's default exit → a handler that never exits (open sockets, intervals) hangs until SIGKILL; no handler means in-flight work is cut. Fix: stop intake, drain with a deadline, then exit.
- **`'error'` without a listener**: an `EventEmitter` (socket, stream, DB/Redis client, custom emitter) emitting `'error'` with no listener throws → process crash. Fix: attach `'error'` listeners to long-lived emitters.
- **Async listeners**: `emitter.on('x', async () => …)` rejections are unhandled (`emit` ignores returned promises), and `emit()` runs listeners synchronously so a throwing listener aborts the caller. Fix: try/catch inside listeners or `captureRejections: true`.
- **`process.env` coerces on write**: `process.env.X = undefined` stores the string `'undefined'` (a truthy value later read as set); numbers and booleans become strings. Fix: `delete process.env.X`; assign strings only.
