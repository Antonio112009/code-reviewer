---
name: Async iteration and generators
description: for await...of over pre-started promises, one-shot iterators, early exits that close the source, abandoned async generators, lazy iterator helpers and sequential Array.fromAsync.
priority: 55
activation:
  content:
    - '\bfor\s+await\s*\('
    - '\bfunction\s*\*|\byield\b'
    - '\bSymbol\.(?:asyncIterator|iterator)\b'
    - '\bArray\.fromAsync\s*\('
    - '\bIterator\.(?:from|concat)\s*\('
    - '\.(?:values|entries|keys)\(\)\.(?:map|filter|take|drop|flatMap|reduce|toArray|forEach|some|every|find)\('
    - '\.matchAll\s*\('
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/fromAsync
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Iterator
  - https://nodejs.org/api/stream.html#readablesymbolasynciterator
---
- **for await over pre-started promises**: `for await (const r of promises)` over promises created up front → one rejecting while an earlier one is awaited counts as unhandled (Node exits by default). Fix: `Promise.all`/`allSettled`, or start each call inside the loop.
- **One-shot iterators**: generators, `map.entries()`, `str.matchAll()`, iterator-helper results and streams can be consumed once; a second pass (e.g. after spreading to count) yields nothing → silently empty results. Fix: materialize once with `Array.from`/`.toArray()`.
- **Early exit closes the source**: `break`, `return` or a throw inside `for…of`/`for await` calls the iterator's `return()` → the generator's `finally` runs and a Node readable is destroyed; reusing it later yields nothing. Fix: pull with `next()` when partial reads must resume.
- **Abandoned async generators**: consumers that stop calling `next()` without `return()` never run the generator's `finally` → DB cursors, file handles or connections leak. Fix: consume with `for await`, or call `it.return()` in `finally`.
- **Lazy iterator helpers**: `iter.map()`/`filter()` (ES2025, Node ≥22) run nothing until the result is consumed; callbacks with side effects silently never execute. Fix: `.toArray()` or an explicit loop when effects matter.
- **`Array.fromAsync(items, asyncFn)` is sequential**: it awaits one element and one mapper call at a time - not a parallel `Promise.all` replacement → N× latency. Fix: `Promise.all(items.map(asyncFn))` with a concurrency limit.
