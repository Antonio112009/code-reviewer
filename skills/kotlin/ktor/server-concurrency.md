---
name: Ktor server concurrency and blocking
description: Throughput and lifecycle defects in Ktor servers — blocking Exposed/JDBC transactions in handlers, background jobs capturing the call, work continuing after client disconnect, shared mutable WebSocket state and resources not closed on shutdown.
priority: 64
tags: [CWE-400, CWE-362, CWE-404]
activation:
  content:
    - '\btransaction\s*[({]|\b(?:newSuspendedTransaction|suspendTransaction)\s*[({]'
    - '\b(?:application|GlobalScope)\.launch\s*[({]'
    - '\bwebSocket\s*\(|\bDefaultWebSocketServerSession\b'
    - '\bHttpRequestLifecycle\b|\bcancelCallOnClose\b'
    - '\bmonitor\.subscribe\s*\(|\bApplicationStopp(?:ing|ed)\b'
    - '\b(?:File|Files)\.(?:readBytes|readText|writeBytes|writeText|readAllBytes)\b|\.(?:readBytes|readText)\s*\(\s*\)'
sources:
  - https://ktor.io/docs/server-http-request-lifecycle.html
  - https://ktor.io/docs/server-websockets.html
  - https://www.jetbrains.com/help/exposed/migration-guide-1-0-0.html
  - https://ktor.io/docs/db-persistence.html
---
- **Exposed/JDBC in handlers**: Exposed `transaction {}` or other blocking JDBC in a route runs on engine request threads → a few slow queries stall all requests. Fix: `newSuspendedTransaction(Dispatchers.IO)` (Exposed < 1.0) or `withContext(Dispatchers.IO) { suspendTransaction {…} }` (1.0).
- **Background work capturing call**: `application.launch`/`GlobalScope.launch` blocks that use `call` after the handler returned → invalid call, lost errors, jobs not cancelled on shutdown. Fix: copy the data out; application scope only.
- **Work after disconnect**: Ktor keeps processing a request after the client disconnects by default → wasted CPU/DB on abandoned long requests. Fix: `install(HttpRequestLifecycle) { cancelCallOnClose = true }` (Ktor 3.4+, Netty/CIO) with cancellable code.
- **Shared WebSocket state**: a plain `mutableListOf`/`HashSet` of sessions modified by concurrent connection coroutines → `ConcurrentModificationException`, lost clients; failed `send` to a closed session aborts broadcasts. Fix: concurrent collections, remove in `finally`, catch per-session send failures.
- **Resources on shutdown**: `HttpClient`, `HikariDataSource`, consumers created in modules but never closed on `ApplicationStopped` → leaks on restart/hot reload and in tests. Fix: `monitor.subscribe(ApplicationStopped) { close() }`.
