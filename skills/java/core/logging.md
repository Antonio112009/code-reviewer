---
name: Logging with SLF4J, Log4j 2 and MDC
description: Lost stack traces, misplaced exception arguments, eager message construction in hot paths, MDC values leaking between pooled requests or missing in async threads, and secrets logged through toString of records and Lombok DTOs.
priority: 52
tags: [CWE-532, CWE-778]
activation:
  content:
    - '\b(?:log|logger|LOG|LOGGER|Log|Logger)\.(?:trace|debug|info|warn|error|atError|atWarn|atInfo|atDebug)\('
    - '\bMDC\.'
    - '\bThreadContext\.'
sources:
  - https://www.slf4j.org/faq.html
  - https://logback.qos.ch/manual/mdc.html
  - https://logging.apache.org/log4j/2.x/manual/api.html
---
- **Lost stack trace**: `log.error("Failed: " + e)` or `log.error("Failed {}", e.getMessage())` logs only the message → root cause missing. Fix: exception as the last argument: `log.error("Failed for {}", id, e)`.
- **Exception not last**: a Throwable that isn't the last argument, or is consumed by a `{}` placeholder, is printed via `toString()` without its stack trace. Fix: keep it last and unmatched.
- **Eager messages**: concatenation, `String.format` or costly `toString()`/JSON in `debug`/`trace` calls cost CPU even when disabled (SLF4J measures ≥30×). Fix: `{}` placeholders, `isDebugEnabled()` guards or lambda suppliers.
- **MDC leaks**: `MDC.put`/`ThreadContext.put` without `remove`/`clear` in `finally` → values stay on pooled threads and label the next request with another user or tenant. Fix: try/finally or `MDC.putCloseable`.
- **MDC across threads**: executors, `@Async`, `CompletableFuture` and reactive operators don't inherit MDC → correlation ids vanish. Fix: copy `MDC.getCopyOfContextMap()` into tasks or use context propagation.
- **Secrets via toString**: logging records (their `toString` prints every component), Lombok `@Data`/`@ToString` DTOs or entities holding passwords, tokens or card data. Fix: `@ToString.Exclude`, custom `toString`, log ids only.
