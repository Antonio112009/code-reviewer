---
name: Typing constructs that do nothing at runtime
description: Types that don't validate — cast/TypedDict/NewType on untrusted data, isinstance with generics or typing constructs, runtime_checkable protocols (3.12 getattr_static change), lying TypeGuard/TypeIs, @overload without implementation and Optional without a default.
priority: 52
activation:
  content:
    - "\\bcast\\s*\\(|\\bTypedDict\\b|\\bNewType\\s*\\("
    - "\\bisinstance\\s*\\([^)\\n]{1,120}\\["
    - "\\bruntime_checkable\\b|\\bProtocol\\b"
    - "\\b(?:TypeGuard|TypeIs)\\b|@(?:typing\\.)?overload\\b"
    - "\\bOptional\\s*\\["
  examples:
    - 'user = cast(User, json.loads(body))'
    - 'if isinstance(value, list[int]):'
    - '@runtime_checkable'
    - 'def is_str_list(val: list) -> TypeGuard[list[str]]:'
    - 'def f(x: Optional[int] = None):'
sources:
  - https://docs.python.org/3/library/typing.html#typing.cast
  - https://docs.python.org/3/library/typing.html#typing.runtime_checkable
  - https://docs.python.org/3/library/typing.html#typing.TypeIs
  - https://docs.python.org/3/library/typing.html#typing.overload
---
- **Types are not validation**: `cast()`, `TypedDict`, `NewType`, `Literal` and annotations do nothing at runtime → `cast(User, json.loads(body))` or a TypedDict from a request may lack keys or hold wrong types. Fix: validate untrusted data (pydantic, msgspec, explicit checks).
- **`isinstance` with typing constructs**: `isinstance(x, list[int])`, unions containing generics, TypedDicts, NewTypes, `Literal` or `Any` raise TypeError at runtime. Fix: check the origin (`list`) and elements manually.
- **Runtime protocols check names only**: `@runtime_checkable` verifies attribute presence, not signatures or types; since 3.12 it uses `inspect.getattr_static`, so attributes served by `__getattr__` stop matching and raising properties now match. Fix: explicit checks or ABCs.
- **Lying type guards**: a `TypeGuard`/`TypeIs` function returning True for values that aren't the declared type makes checkers trust wrong narrowing; `TypeGuard` doesn't narrow the False branch. Fix: check exactly what it claims; prefer `TypeIs` (3.13+).
- **`@overload` without implementation**: overloads must be followed by one undecorated implementation; if the last definition is decorated, every call raises NotImplementedError. Fix: add the real implementation last.
- **`Optional` is not optional**: `def f(x: Optional[int])` still requires the argument, and `x: int = None` silently admits None → None reaches arithmetic or DB writes. Fix: explicit `= None` defaults plus None handling.
