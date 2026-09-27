---
name: RxJS operator semantics
description: Wrong flattening, error-handling and combination operators in Angular streams — out-of-order reads, cancelled writes, streams killed by catchError, forkJoin/combineLatest that never emit, EmptyError and unsafe retries.
priority: 60
activation:
  content:
    - "\\b(?:switchMap|mergeMap|concatMap|exhaustMap|flatMap)\\s*\\("
    - "\\b(?:catchError|retry|retryWhen)\\s*\\("
    - "\\b(?:forkJoin|combineLatest|withLatestFrom|zip)\\s*\\("
    - "\\b(?:first|single|last)\\s*\\(\\s*\\)"
sources:
  - https://rxjs.dev/api/operators/switchMap
  - https://rxjs.dev/api/operators/catchError
  - https://rxjs.dev/api/index/function/forkJoin
  - https://rxjs.dev/api/index/function/combineLatest
---
- **mergeMap for reads**: search, typeahead or route-param loads with `mergeMap` → responses arrive out of order; stale results overwrite fresh ones. Fix: `switchMap`.
- **switchMap for writes**: saves/deletes/payments inside `switchMap` → a newer emission unsubscribes the in-flight request; the server may still apply it while the client drops the result. Fix: `concatMap` (ordered) or `exhaustMap` (ignore double submits).
- **Stream killed by catchError**: `catchError` on the outer pipe of an effect, `valueChanges` or event stream → the first error completes the stream; later events are silently ignored. Fix: catch inside the inner observable.
- **forkJoin never emits**: a source that never completes (Subject, store select, `valueChanges`) → no emission; a source completing empty → completes without a value. Fix: `take(1)` per source, or `combineLatest`.
- **combineLatest waits**: any source that has not emitted yet (plain `Subject`, pending request) blocks all output. Fix: `startWith`, `BehaviorSubject`.
- **first() on empty**: `first()`/`single()`/`last()` on a stream that completes without a value → `EmptyError`. Fix: `take(1)` or a default value.
- **Blind retry**: `retry()` on POST/PUT/PATCH or without delay → duplicated side effects, request storms. Fix: retry idempotent reads only, with backoff (`retry({ count, delay })`).
