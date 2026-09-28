---
name: Cold flow operators
description: Cold Flow contract violations — withContext or other coroutines emitting inside flow {}, flowOn and catch acting only upstream, catching downstream exceptions around emit, collect that never returns, and retry on every exception.
priority: 63
tags: [CWE-248, CWE-835]
activation:
  content:
    - '\bflow\s*\{'
    - '\bemit\s*\('
    - '\.flowOn\s*\('
    - '\.catch\s*\{'
    - '\.retry(?:When)?\s*[({]'
    - '\.collect(?:Latest)?\s*[({]'
    - '\.(?:combine|zip|flatMapLatest|flatMapMerge|onEach)\s*[({]'
  examples:
    - 'val ticker = flow { emit(1) }'
    - 'source.flowOn(Dispatchers.IO)'
    - 'source.catch { e -> emit(fallback) }'
    - 'source.retryWhen { cause, attempt -> attempt < 3 }'
    - 'source.collectLatest { value -> render(value) }'
    - 'flowA.combine(flowB) { a, b -> a + b }'
sources:
  - https://kotlinlang.org/docs/flow.html
  - https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/flow.html
  - https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/catch.html
---
- **Context preservation**: `withContext(Dispatchers.IO) { emit(x) }` or `emit` from another `launch` inside `flow {}` → `IllegalStateException: Flow invariant is violated`. Fix: `.flowOn(Dispatchers.IO)` or `channelFlow {}` for concurrent emission.
- **flowOn scope**: `flowOn` changes only operators above it; `map`/`collect` below still run in the collector's context (often Main) → heavy work on the UI thread. Fix: place `flowOn` after the expensive operators.
- **catch is upstream-only**: `.catch {}` doesn't see exceptions thrown in `collect {}` or operators after it → crash despite the handler. Fix: move work into `onEach` before `catch`, then `collect()`.
- **Exception transparency**: `try { emit(v) } catch (e: Exception)` inside `flow {}` swallows the collector's exceptions (and cancellation) and may emit again → `IllegalStateException`, hidden failures. Fix: wrap only the producing call, not `emit`.
- **collect never returns**: code after `collect {}` of an infinite or hot flow (`StateFlow`, ticker, DB observer) is unreachable; two sequential collects run only the first. Fix: separate `launch` per flow or `combine`.
- **retry everything**: `.retry()`/`retryWhen { true }` retries programming errors and hammers backends without delay. Fix: retry only `IOException`-like causes, with a bounded count and backoff.
