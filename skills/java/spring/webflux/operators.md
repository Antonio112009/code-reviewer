---
name: Reactor operator pitfalls
description: Mono/Flux mistakes — publishers never subscribed, nested subscribe() calls, eagerly evaluated just/switchIfEmpty arguments, unbounded flatMap concurrency, empty sources in zip, swallowed errors and sticky cache()/unbounded retry().
priority: 64
tags: [CWE-400, CWE-755]
activation:
  content:
    - '\b(?:Mono|Flux)\b'
    - '\.(?:subscribe|flatMap|flatMapMany|switchIfEmpty|defaultIfEmpty|zip|zipWith|zipWhen|onErrorResume|onErrorReturn|onErrorContinue|retry|retryWhen|cache)\('
sources:
  - https://projectreactor.io/docs/core/release/reference/faq.html
  - https://projectreactor.io/docs/core/release/api/reactor/core/publisher/Flux.html
  - https://projectreactor.io/docs/core/release/api/reactor/core/publisher/Mono.html
---
- **Never subscribed**: `repository.save(x)` or `flux.map(...)` whose returned publisher is ignored → nothing executes. Fix: return or compose it (`then`, `flatMap`).
- **Nested subscribe**: `.subscribe()` inside `map`/`flatMap`/`doOnNext` or a handler → fire-and-forget: errors lost, no backpressure or cancellation, context dropped. Fix: `flatMap`, `then`, `Mono.when`.
- **Eager arguments**: `Mono.just(load())`, `switchIfEmpty(Mono.just(create()))`, `defaultIfEmpty(fetch())` evaluate immediately, even when unused → wasted calls or unwanted writes. Fix: `Mono.defer`/`fromCallable`.
- **flatMap concurrency**: `flatMap` subscribes up to 256 inner publishers at once and loses order → floods DB/HTTP pools. Fix: `flatMap(f, n)`; `concatMap`/`flatMapSequential` when order matters.
- **Empty zip**: an empty `Mono` (or `Mono<Void>`) in `zip`/`zipWith`/`zipWhen` completes the whole zip empty → downstream silently skipped. Fix: `defaultIfEmpty`, or `then`/`when` for `Void`.
- **Swallowed errors**: `onErrorResume(e -> Mono.empty())`, blanket `onErrorReturn`, or `onErrorContinue` (operator-dependent semantics) hide failures. Fix: match specific exceptions; log and propagate.
- **Sticky cache, endless retry**: `cache()` replays errors or empty results forever; `retry()` without limits or backoff re-sends non-idempotent calls. Fix: TTL-based `cache`, `retryWhen(Retry.backoff(n, …).filter(...))`.
