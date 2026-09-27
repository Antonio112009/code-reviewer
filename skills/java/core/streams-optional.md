---
name: Streams and Optional
description: Stream API and Optional misuse — reused streams, skipped peek/map side effects, parallel streams on the common pool, eager orElse arguments, Optional.get/of misuse, null Optionals and unbounded infinite streams.
priority: 55
tags: [CWE-248, CWE-400]
activation:
  content:
    - '\.stream\(\)'
    - '\bStream\.'
    - '\bOptional\b'
    - '\.parallel(?:Stream)?\(\)'
    - '\.(?:peek|orElse|orElseThrow|findAny)\('
sources:
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html
---
- **Reused stream**: a `Stream` kept in a variable or field and consumed twice → `IllegalStateException`. Fix: call `.stream()` per use or pass a `Supplier<Stream<T>>`.
- **Skipped side effects**: work done in `peek`/`map` may never run — since JDK 9 `count()` can skip the pipeline when the size is known, and short-circuiting ops skip elements. Fix: side effects in `forEach` or a loop.
- **Parallel streams**: `parallelStream()`/`.parallel()` doing I/O runs on the shared `ForkJoinPool.commonPool()`, and `forEach` adding to an `ArrayList`/`HashMap` corrupts it. Fix: sequential streams, `collect`, or a dedicated executor.
- **Optional.get / of**: `get()`/`orElseThrow()` without a presence check → `NoSuchElementException`; `Optional.of(nullable)` → NPE. Fix: `ofNullable`, `orElse*`, `map`.
- **Eager orElse**: `orElse(create())` always evaluates its argument — `orElse(repo.save(new X()))` inserts on every call. Fix: `orElseGet(() -> ...)`.
- **null Optionals**: methods typed `Optional` returning `null`; `Optional` fields/parameters aren't `Serializable` (sessions, caches, JPA). Fix: `Optional.empty()`; use `Optional` only as a return type.
- **Unbounded streams**: `Stream.iterate`/`generate` without `limit`/`takeWhile` never end; `sorted()`/`distinct()` buffer every element. Fix: bound the stream first.
