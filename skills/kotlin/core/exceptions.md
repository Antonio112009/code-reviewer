---
name: Exceptions and resource cleanup
description: Kotlin exception-handling defects — TODO() and assert() semantics, runCatching/Throwable catches that swallow fatal errors, ignored Result values, missing use {} and control flow in finally.
priority: 57
tags: [CWE-248, CWE-396, CWE-404, CWE-617]
activation:
  content:
    - '\bTODO\s*\('
    - '\bassert\s*\('
    - '\brunCatching\s*\{'
    - '\bcatch\s*\(\s*\w+\s*:\s*(?:Throwable|Exception)\s*\)'
    - '\bfinally\s*\{'
    - '\b(?:FileInputStream|FileOutputStream|RandomAccessFile|ZipFile|Socket)\s*\('
    - '\.(?:bufferedReader|bufferedWriter|inputStream|outputStream|openStream|openConnection|getConnection|prepareStatement|executeQuery|rawQuery)\s*\('
  examples:
    - 'TODO("handle refund flow")'
    - 'assert(balance >= 0) { "balance must be non-negative" }'
    - 'runCatching { repository.save(order) }'
    - 'catch (e: Exception) { logger.warn(e) }'
    - 'finally { connection.close() }'
    - 'val socket = Socket(host, port)'
    - 'val body = connection.getInputStream().bufferedReader().readText()'
sources:
  - https://kotlinlang.org/api/core/kotlin-stdlib/kotlin/-t-o-d-o.html
  - https://kotlinlang.org/api/core/kotlin-stdlib/kotlin/assert.html
  - https://kotlinlang.org/api/core/kotlin-stdlib/kotlin/run-catching.html
  - https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.io/use.html
---
- **TODO() is an Error**: `TODO()` throws `NotImplementedError`, an `Error` → it escapes `catch (e: Exception)` and kills the thread or request. Fix: no reachable `TODO()`; throw `UnsupportedOperationException`.
- **assert() is off**: Kotlin/JVM `assert(cond)` runs only with `-ea` (never on Android, off by default on servers) → validation silently skipped. Fix: `require`/`check`.
- **Throwable catches**: `runCatching {}` and `catch (e: Throwable)` also swallow `OutOfMemoryError`, `StackOverflowError`, `InterruptedException` (coroutine cancellation: see coroutines) → broken state continues, interrupts lost. Fix: catch specific types; rethrow `Error`s.
- **Ignored Result**: `runCatching { save() }` as a statement, or a returned `Result` never unwrapped (`getOrThrow`, `onFailure`) → failures vanish without a log. Fix: handle or propagate the failure.
- **Missing `use {}`**: streams, readers, `Cursor`, JDBC `Connection`/`ResultSet`, sockets not closed on the exception path → descriptor and connection-pool exhaustion. Fix: `.use { }`.
- **Control flow in `finally`**: `return`, `break` or a throwing call inside `finally` replaces the original exception → root cause lost, error reported as success. Fix: keep `finally` to cleanup; `addSuppressed`.
