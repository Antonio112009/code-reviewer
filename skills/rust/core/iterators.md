---
name: Iterator and collection traps
description: Iterator adapters and collections that silently lose or reorder data — zip truncation, chunks_exact remainders, take_while consumption, consecutive-only dedup, map overwrites, swallowed read errors and random hash order.
priority: 55
tags: [CWE-835, CWE-392]
activation:
  content:
    - '\.(?:zip|chunks_exact|rchunks_exact|take_while|skip_while|dedup|dedup_by|dedup_by_key|lines|flatten|filter_map|read_dir)\('
    - 'collect::<\s*(?:std::collections::)?(?:Hash|BTree)(?:Map|Set)\b'
    - '\bHash(?:Map|Set)\b'
sources:
  - https://doc.rust-lang.org/std/iter/trait.Iterator.html#method.zip
  - https://doc.rust-lang.org/std/iter/trait.Iterator.html#method.take_while
  - https://doc.rust-lang.org/std/io/trait.BufRead.html#method.lines
  - https://doc.rust-lang.org/std/collections/struct.HashMap.html
---
- **`zip` truncates**: pairing sequences of possibly different length (headers/values, expected/actual, ids/rows) silently drops the tail → lost data or validation passing on partial input. Fix: compare lengths or `itertools::zip_eq`.
- **`chunks_exact` remainder**: trailing elements are skipped unless `.remainder()` is handled → last partial block never processed, hashed or sent.
- [full] **`take_while`/`skip_while` consume one more**: with `by_ref()` the first non-matching element is removed and lost → parsers skip a token. Fix: `peekable()` + `next_if`.
- [full] **`dedup` is consecutive-only**: duplicates survive on unsorted data. Fix: sort first, or `HashSet`/`BTreeSet`.
- **Collecting into maps overwrites**: `collect::<HashMap<_, _>>()` and repeated `insert` keep the last value per key silently → dropped records, a later duplicate overriding an earlier rule. Fix: detect duplicates with `entry()`.
- **Endless read errors**: `lines().flatten()` or `lines().filter_map(Result::ok)` loops forever on a persistent error (reading a directory yields `Err` on every call). Fix: `map_while(Result::ok)` or `?`.
- [full] **Random hash order**: iterating `HashMap`/`HashSet` to build signatures, cache keys, output files, pagination or snapshots → order differs per process. Fix: `BTreeMap`, `IndexMap`, or sort first.
