---
name: Scoping and late binding
description: Python name-binding traps — closures reading loop variables late, UnboundLocalError from later assignments, the except-as name being deleted, class-body scope, walrus leaks and exec/locals() semantics (PEP 667, 3.13).
priority: 58
activation:
  content:
    - "\\blambda\\b"
    - "\\b(?:nonlocal|global)\\s+\\w"
    - "(?<![\\w.])(?:exec|eval)\\s*\\(|\\blocals\\s*\\(\\s*\\)"
    - ":=\\s*"
  examples:
    - 'callbacks.append(lambda: handle(i))'
    - 'nonlocal counter'
    - 'exec("x = 1")'
    - 'if (n := len(data)) > 10:'
sources:
  - https://docs.python.org/3/faq/programming.html#why-do-lambdas-defined-in-a-loop-with-different-values-all-return-the-same-result
  - https://docs.python.org/3/reference/compound_stmts.html#except-clause
  - https://docs.python.org/3/reference/executionmodel.html#resolution-of-names
  - https://docs.python.org/3/whatsnew/3.13.html#defined-mutation-semantics-for-locals
---
- **Late-binding closures**: lambdas/inner functions created in a loop (callbacks, `Thread(target=lambda: f(i))`, handler dicts) read the loop variable when called → all see its last value. Fix: `lambda i=i: …` or `functools.partial`.
- **UnboundLocalError**: any assignment to a name in a function (`=`, `+=`, `for x`, `with … as x`, `import x`) makes it local for the whole function → earlier reads of the global raise. Fix: rename, `global`/`nonlocal`, or pass it in.
- **`except … as e` is deleted**: the name is unbound after the except clause → using `e` after the try, in `finally` or on the next retry raises NameError. Fix: copy it to another variable inside.
- **Class-body scope**: class-level names are invisible inside methods, lambdas and comprehensions of that body (except the first iterable) → NameError. Fix: `self.X`/`cls.X` or module constants.
- **Loop variable after the loop**: it holds the last item, or is unbound/stale when the iterable was empty. Fix: initialize before the loop.
- **Walrus in comprehensions**: `:=` binds in the enclosing function, overwriting a same-named outer variable. Fix: distinct names.
- **`exec`/`locals()`**: in functions, `exec("x = 1")` and writes to `locals()` never create real locals; since 3.13 (PEP 667) `locals()` returns an independent snapshot → accidental working code breaks. Fix: pass an explicit namespace dict.
