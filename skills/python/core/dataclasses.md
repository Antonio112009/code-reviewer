---
name: Dataclasses
description: dataclasses pitfalls — shared hashable defaults, eq without frozen making instances unhashable, shallow frozen, replace() re-running __post_init__, skipped base __init__, inheritance field order (kw_only) and the 3.13 field-wise __eq__.
priority: 57
activation:
  content:
    - "@(?:dataclasses\\.)?dataclass\\b"
    - "\\bdataclasses\\.\\w+|\\b(?:asdict|astuple|replace)\\s*\\("
    - "\\bfield\\s*\\(\\s*(?:default|init|compare|hash|kw_only|repr)"
    - "\\b__post_init__\\b|\\bInitVar\\b|\\bKW_ONLY\\b"
  examples:
    - '@dataclass(frozen=True)'
    - 'return dataclasses.replace(user, name="Bo")'
    - 'retries: int = field(default=3)'
    - 'def __post_init__(self):'
sources:
  - https://docs.python.org/3/library/dataclasses.html#mutable-default-values
  - https://docs.python.org/3/library/dataclasses.html#dataclasses.replace
  - https://docs.python.org/3/library/dataclasses.html#post-init-processing
  - https://docs.python.org/3/library/dataclasses.html#dataclasses.dataclass
---
- **Shared defaults**: only unhashable defaults raise ValueError (list/dict/set; any unhashable since 3.11) → a hashable but mutable default object (custom class instance) is shared by all instances. Fix: `field(default_factory=...)`.
- **Unhashable by default**: `eq=True` without `frozen=True` sets `__hash__ = None` → TypeError as dict key, set member or cache argument; `unsafe_hash=True` on mutable fields breaks sets after mutation. Fix: `frozen=True` for value objects.
- **`frozen` is shallow**: list/dict fields stay mutable and changing them changes `hash()` → lost set/dict entries. Fix: tuples, frozensets.
- **`replace()` re-runs init**: `dataclasses.replace()`/`copy.replace()` call `__init__` and `__post_init__` again and reset `init=False` fields → repeated side effects, lost derived state. Fix: idempotent `__post_init__`.
- **Base `__init__` skipped**: the generated `__init__` never calls a non-dataclass base's `__init__` → missing attributes. Fix: call it from `__post_init__`.
- **Field order with inheritance**: base fields with defaults followed by subclass fields without raise TypeError at import. Fix: `kw_only=True` (3.10+).
- **`asdict()` cost**: recurses and deep-copies every value → slow on large graphs. Fix: build dicts explicitly on hot paths.
- **3.13 equality**: `__eq__` compares fields one by one instead of as tuples → instances holding NaN now compare unequal. Fix: `field(compare=False)` or no NaN.
