---
name: Exceptions and control flow
description: Bare/BaseException catches swallowing cancellation and exit, return in finally (PEP 765, 3.14), raise NotImplemented, lost causes, over-wide try blocks and assert used as a runtime check.
priority: 60
tags: [CWE-396, CWE-617, OWASP-A10]
activation:
  content:
    - "^[ \\t]*except\\s*(?::|\\(?\\s*BaseException\\b)"
    - "^[ \\t]*finally\\s*:"
    - "\\braise\\s+NotImplemented\\b(?!Error)"
    - "\\bfrom\\s+None\\b"
    - "^[ \\t]*assert\\b[^\\n]{0,80}\\b(?:auth\\w*|perm\\w*|admin|allowed|owner|role|token|is_staff|is_superuser|can_\\w+|has_\\w+|user)\\b"
  examples:
    - '    except:'
    - '    finally:'
    - 'raise NotImplemented'
    - 'raise ValueError(msg) from None'
    - 'assert request.user.is_staff'
sources:
  - https://docs.python.org/3/library/exceptions.html#exception-hierarchy
  - https://docs.python.org/3/whatsnew/3.14.html#pep-765-control-flow-in-finally-blocks
  - https://docs.python.org/3/library/exceptions.html#exception-groups
  - https://docs.python.org/3/reference/simple_stmts.html#the-assert-statement
---
- **Bare or BaseException catch**: `except:`/`except BaseException:` also catch `KeyboardInterrupt`, `SystemExit` and `asyncio.CancelledError` (BaseException since 3.8) → shutdown and cancellation swallowed, workers hang. Fix: `except Exception`, or re-raise.
- **Control flow in `finally`**: `return`/`break`/`continue` in `finally` discards the in-flight exception (SyntaxWarning since 3.14, PEP 765) → failures become normal returns. Fix: move it after the `try`.
- **`raise NotImplemented`**: raises `TypeError: exceptions must derive from BaseException` instead. Fix: `raise NotImplementedError`.
- **Lost cause**: `raise X(...) from None`, `raise Exception(str(e))` or logging only `str(e)` drops the original traceback → undiagnosable failures. Fix: `raise X(...) from e`; `logger.exception`.
- **Too-wide `try`**: `except KeyError/AttributeError/TypeError` around many statements also catches bugs raised deep inside called code → wrong fallback silently taken. Fix: wrap only the failing call; use `else:`.
- **`assert` as a check**: authorization or validation written with `assert` is removed under `python -O`/`PYTHONOPTIMIZE` → checks vanish in optimized deployments. Fix: `if not cond: raise …`.
