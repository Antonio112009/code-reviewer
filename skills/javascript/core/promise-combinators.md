---
name: Promise combinators
description: Promise.all / allSettled / any / race semantics - failures that cancel nothing, unchecked settled results, race-based timeouts that leak work and timers, and empty-input edge cases.
priority: 60
activation:
  content: ['\bPromise\.(?:all|allSettled|any|race)\s*\(']
  examples:
    - 'const results = await Promise.allSettled(jobs);'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/race
  - https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static
---
- **`all` fails fast but cancels nothing**: after the first rejection the other operations keep running (writes land, connections stay busy) and their errors are dropped; retrying the batch duplicates side effects. Fix: `allSettled`, or abort siblings via an `AbortSignal`.
- **`allSettled` never rejects**: awaiting it, or reading `.value` without checking `status === 'rejected'`, treats failures as success (`undefined` values, silently skipped items). Fix: partition by `status` and handle the rejected ones.
- **`race` as a timeout**: `Promise.race([op(), sleep(ms)])` does not stop `op` (its side effects still happen later), and an uncleared timer keeps Node alive or piles up per call. Fix: pass `AbortSignal.timeout(ms)` into the operation; clear timers in `finally`.
- **Empty inputs**: `Promise.race([])` never settles (hang), `Promise.any([])` rejects with `AggregateError`, `Promise.all([])` resolves at once - surprising when the list comes from a filter. Fix: guard empty lists.
- **`any` hides causes**: it rejects with `AggregateError` whose `message` is generic; the real errors are in `err.errors`. Fix: log or inspect `err.errors`.
