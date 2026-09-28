---
name: Equality, identity and hashing
description: __eq__ without __hash__, hashes of mutable state, identity checks on values, per-process str hashes, 1/1.0/True key collisions and NotImplemented handling (TypeError in boolean context since 3.14).
priority: 56
activation:
  content:
    - "\\bdef\\s+__(?:eq|ne|hash|lt|le|gt|ge)__\\s*\\("
    - "\\bis\\s+(?:not\\s+)?(?:-?\\d|[bfru]?[\"']|\\[|\\{|\\()"
    - "(?<![\\w.])hash\\s*\\("
    - "\\b(?:unsafe_hash|frozen)\\s*=\\s*True\\b"
    - "\\bNotImplemented\\b"
  examples:
    - 'def __eq__(self, other):'
    - 'if role is "admin":'
    - 'digest = hash(key)'
    - '@dataclass(unsafe_hash=True)'
    - 'return NotImplemented'
sources:
  - https://docs.python.org/3/reference/datamodel.html#object.__hash__
  - https://docs.python.org/3/library/stdtypes.html#mapping-types-dict
  - https://docs.python.org/3/whatsnew/3.8.html#changes-in-python-behavior
  - https://docs.python.org/3/whatsnew/3.14.html#other-language-changes
---
- **`__eq__` without `__hash__`**: defining `__eq__` sets `__hash__ = None` → TypeError as dict key, set member or `lru_cache` argument; hashing other fields than `__eq__` compares breaks lookups. Fix: hash the same immutable fields.
- **Hash of mutable state**: objects whose hash changes after insertion (custom `__hash__`, `unsafe_hash=True`) become unreachable in sets/dicts → duplicates, failed lookups. Fix: hash immutable identity fields; `frozen=True`.
- **`is` for values**: `x is 1000`, `s is "admin"`, `x is []` compare identity; interning makes tests pass and production fail (SyntaxWarning since 3.8). Fix: `==`; `is` only for `None`, sentinels, enum members.
- **`hash()` of str is per-process**: str/bytes hashes are salted per run (PYTHONHASHSEED) → shard choice, on-disk cache keys or ids derived from `hash()` differ across workers and restarts. Fix: `hashlib`/`zlib.crc32` on bytes.
- **Numeric key collisions**: `1`, `1.0` and `True` are equal with equal hashes → `{1: "a", True: "b"}` keeps one entry; sets merge `0` and `False`. Fix: don't mix bools and numbers as keys.
- **`NotImplemented`**: `__eq__`/`__lt__` returning `False` for unknown types breaks reflected comparisons; a `NotImplemented` result used in `if` raises TypeError since 3.14. Fix: `return NotImplemented`; compare with `==`, not dunder calls.
