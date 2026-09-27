---
name: Ord, Eq and Hash contracts
description: Inconsistent PartialEq/Eq/Hash/Ord/Borrow implementations, NaN-unsafe comparators, declaration-order derives, mutated keys and DoS-prone hashers that break maps, sets and sorting.
priority: 55
tags: [CWE-697, CWE-407]
activation:
  content:
    - '\b(?:Partial)?(?:Ord|Eq)\s+for\s+\w'
    - '\bHash\s+for\s+\w'
    - '\bfn\s+(?:cmp|partial_cmp|eq|hash)\s*[<(]'
    - '#\[derive\([^)\n]{0,200}\b(?:PartialOrd|Ord|Hash)\b'
    - '\.(?:sort_by|sort_unstable_by|max_by|min_by|binary_search_by)\(|\bpartial_cmp\b'
    - '\bBorrow<|\b(?:FxHash|FnvHash)(?:Map|Set)\b|\bBuildHasherDefault\b'
sources:
  - https://doc.rust-lang.org/std/hash/trait.Hash.html#hash-and-eq
  - https://doc.rust-lang.org/std/cmp/trait.Ord.html
  - https://blog.rust-lang.org/2024/09/05/Rust-1.81.0/
  - https://doc.rust-lang.org/std/collections/struct.HashMap.html
---
- **`Hash` disagrees with `Eq`**: manual `PartialEq` (case-insensitive, ignoring a field) with derived `Hash`, or the reverse → maps miss equal keys and keep duplicates. Fix: hash exactly the fields `eq` compares.
- **`Ord` vs `PartialOrd`/`Eq`**: manual `partial_cmp` with derived `Ord` (or vice versa) → sorting, `BTreeMap` and `binary_search` disagree; since Rust 1.81 `sort*` may panic on non-total orders. Fix: implement `cmp`; `partial_cmp` returns `Some(self.cmp(other))`.
- **Float comparators**: `partial_cmp(..).unwrap()` panics on NaN; `unwrap_or(Equal)` is non-transitive (panic or garbage order). Fix: `f64::total_cmp`, reject NaN at input.
- [full] **Declaration-order derives**: derived `PartialOrd`/`Ord` compare variants by position, then fields in order → reordering them silently changes sorting, `max()` and checks like `level >= Level::Warn`. Fix: explicit `Ord` or pinning tests.
- **Mutated keys**: changing hashed/ordered fields through `Cell`/`RefCell` while the key is in a map or set → lookups fail. Fix: remove, modify, reinsert.
- [full] **`Borrow` lookups**: `Borrow<str>` on a key whose `Hash`/`Eq` differ from `str` (case folding) → `map.get("x")` misses.
- **Weak hashers**: `FxHashMap`/`FnvHashMap`/`BuildHasherDefault` keyed by attacker input → collision flooding. Fix: std `RandomState` (SipHash).
