---
name: Iterators and generators
description: One-shot iterators consumed twice, always-truthy generators, zip truncation, groupby on unsorted data, mutation during iteration and StopIteration inside generators (PEP 479).
priority: 58
activation:
  content:
    - "(?<![\\w.])(?:map|filter|zip|reversed|iter)\\s*\\("
    - "\\bitertools\\b|\\b(?:groupby|tee|islice|chain|batched)\\s*\\("
    - "(?<![\\w.])next\\s*\\("
    - "^[ \\t]*(?:yield\\b|[^#\\n]{0,80}=\\s*\\([^()\\n]{1,80}\\bfor\\b)"
    - "\\bcsv\\.(?:reader|DictReader)\\s*\\("
  examples:
    - 'rows = list(zip(ids, names))'
    - 'groups = itertools.groupby(rows, key=lambda r: r.id)'
    - 'value = next(it)'
    - 'yield chunk'
    - 'rows = csv.DictReader(f)'
sources:
  - https://docs.python.org/3/glossary.html#term-iterator
  - https://docs.python.org/3/library/functions.html#zip
  - https://docs.python.org/3/library/itertools.html#itertools.groupby
  - https://docs.python.org/3/library/exceptions.html#StopIteration
---
- **Consumed twice**: generators, `map`/`filter`/`zip` objects, files, `csv.reader`, DB cursors are one-shot; a second loop, `len(list(g))` or an `any(g)` pre-check leaves later passes empty → silently missing data. Fix: `list()` once.
- **Always truthy**: `if gen:` or `if map(...):` is true even when nothing is yielded → empty-result branches never run. Fix: materialize, or `next(it, None)`.
- **`zip` truncation**: `zip(a, b)` stops at the shortest input → dropped or misaligned rows. Fix: `strict=True` (3.10+; `map(..., strict=True)` 3.14+) or `zip_longest`.
- **`groupby` on unsorted data**: `itertools.groupby` groups only consecutive keys, and each group dies when the outer loop advances → duplicate or empty groups. Fix: sort by the same key; `list(group)` at once.
- **Mutation while iterating**: changing dict/set size inside `for k in d` raises RuntimeError; removing list items skips the next one. Fix: iterate over a copy.
- **StopIteration in generators**: a bare `next(it)` inside a generator becomes `RuntimeError` at exhaustion since 3.7 (PEP 479). Fix: `next(it, default)` or `for`.
- **Lazy timing**: generator bodies run only when consumed → reading after the `with open()`/session closed fails, and later variable changes leak in. Fix: consume inside the scope.
