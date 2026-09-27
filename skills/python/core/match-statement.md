---
name: Structural pattern matching
description: match/case (3.10+) traps — bare names that capture instead of compare, mapping patterns ignoring extra keys, sequence patterns vs strings, literal == semantics (1 matches True), __match_args__ and missing default cases.
priority: 56
activation:
  content:
    - "^[ \\t]*match\\s[^\\n]{1,120}:[ \\t]*(?:#[^\\n]*)?$"
    - "^[ \\t]*case\\s[^\\n]{1,160}:[ \\t]*(?:#[^\\n]*)?$"
sources:
  - https://docs.python.org/3/reference/compound_stmts.html#the-match-statement
  - https://peps.python.org/pep-0636/
  - https://docs.python.org/3/whatsnew/3.10.html#pep-634-structural-pattern-matching
---
- **Bare names capture**: `case RED:`, `case MAX_SIZE:` or `case str:` bind the subject to that name and always match (shadowing the constant or builtin) → a silent catch-all when last, SyntaxError otherwise. Fix: dotted names (`Color.RED`, `limits.MAX`) and `case str():`.
- **Mapping patterns ignore extra keys**: `case {"type": "user"}` matches dicts with any other keys → unexpected fields accepted. Fix: add `**rest` and require `not rest` in a guard when exact shape matters.
- **Sequences exclude strings**: sequence patterns never match `str`/`bytes` but match any list or tuple (not sets, dicts or iterators) → string input falls through; tuples hit "list" cases. Fix: class patterns like `case list([x, y])` or `case str()`.
- **Literals use `==`**: only `None`/`True`/`False` use `is` → `case 1:` also matches `True` and `1.0`, `case 0:` matches `False`. Fix: put `case bool():` (or `True`/`False`) cases first.
- **Positional class patterns**: `case Point(x, y)` needs `__match_args__` (dataclasses and namedtuples have it; plain classes raise TypeError). Fix: keyword patterns `Point(x=x, y=y)`.
- **Bindings from failed cases**: names bound by a partially matched pattern may persist after the statement → stale values read later. Fix: use captured names only inside their case body.
- **No default case**: without `case _:` unmatched subjects are silently ignored → new enum members or message types skipped. Fix: `case _: raise ValueError(...)` or `assert_never`.
