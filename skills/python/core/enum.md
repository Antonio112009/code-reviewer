---
name: Enums
description: enum pitfalls — members compared to raw values, (str, Enum) formatting change in 3.11, IntEnum str() change, lookups on untrusted input, persisted auto() values, aliases, JSON serialization and containment before 3.12.
priority: 55
activation:
  content:
    - "\\b(?:Str|Int)?Enum\\b|\\b(?:Int)?Flag\\b|\\bReprEnum\\b"
    - "\\benum\\.\\w|\\bauto\\s*\\(\\s*\\)"
sources:
  - https://docs.python.org/3/library/enum.html
  - https://docs.python.org/3/whatsnew/3.11.html#enum
  - https://docs.python.org/3/library/enum.html#enum.EnumType.__contains__
---
- **Members vs values**: `Status.ACTIVE == "active"` is False for a plain `Enum` → comparisons with DB, JSON or request values silently fail. Fix: compare `.value`, convert with `Status(value)`, or use `StrEnum`.
- **`(str, Enum)` formatting (3.11)**: `f"{Color.RED}"` of mixin enums now gives `"Color.RED"`, not the value → broken URLs, SQL, cache keys after upgrade. Fix: `StrEnum` or `.value`.
- **`IntEnum` `str()` (3.11)**: `str(HTTPStatus.OK)` is now `"200"` → changed messages and keys. Fix: `.name`/`.value` explicitly.
- **Lookups on input**: `Status(value)` raises ValueError and `Status[name]` KeyError on unknown input → 500s instead of 400s. Fix: catch and map, or `_missing_`.
- **Persisted `auto()`**: stored `auto()` numbers shift when members are added or reordered (3.13 also changed `auto()` to highest value + 1). Fix: explicit, never-reused values.
- **Silent aliases**: members with equal values become aliases, skipped by iteration. Fix: `@enum.unique`.
- **Serialization**: `json.dumps(member)` raises TypeError unless mixed with `str`/`int`; pickles store names, so renames break loading. Fix: serialize `.value`.
- **Containment**: `"red" in Color` raises TypeError before 3.12 and checks values from 3.12. Fix: `value in {c.value for c in Color}`.
