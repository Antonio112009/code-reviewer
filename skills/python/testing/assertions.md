---
name: Assertions in pytest and unittest
description: Checks that pass without checking — pytest.raises blocks hiding later lines, broad exception types and unescaped match= regexes, tuple asserts, assertTrue(a, b), float equality, ExceptionGroups (pytest.RaisesGroup, 8.4+) and tests that return values.
priority: 52
activation:
  content:
    - "\\bpytest\\.(?:raises|warns|approx|RaisesGroup)\\b|\\bgroup_contains\\s*\\("
    - "\\bassert(?:True|False|Equal|NotEqual|Raises|RaisesRegex|AlmostEqual|Is|In|IsNone)\\s*\\("
    - "^[ \\t]*assert\\s*\\("
    - "^[ \\t]*assert\\s[^\\n]{0,120}==\\s*-?\\d+\\.\\d"
sources:
  - https://docs.pytest.org/en/stable/reference/reference.html#pytest.raises
  - https://docs.pytest.org/en/stable/how-to/assert.html
  - https://docs.pytest.org/en/stable/changelog.html
  - https://docs.python.org/3/library/unittest.html#unittest.TestCase.assertTrue
---
- **`pytest.raises` scope**: lines after the raising call inside the `with` block never run, and an earlier line raising the same type makes the test pass for the wrong reason. Fix: only the raising call inside; assertions after the block.
- **Loose exception checks**: `pytest.raises(Exception)` or `assertRaises(Exception)` pass on any error, including a typo's TypeError; `match=` is `re.search`, so `(`, `[`, `.` in messages need `re.escape`. Fix: specific types plus `match=re.escape(msg)`.
- **Tuple asserts**: `assert (x == 1, "msg")` is always true (non-empty tuple; SyntaxWarning). Fix: `assert x == 1, "msg"`.
- **`assertTrue(a, b)`**: the second argument is the failure message, so `self.assertTrue(result, expected)` only checks truthiness. Fix: `assertEqual(result, expected)`.
- **Float equality**: `==` or `assertEqual` on computed floats fails or passes by luck. Fix: `pytest.approx`, `assertAlmostEqual`, `math.isclose`.
- **Exception groups**: code using TaskGroup, AnyIO or Trio raises `ExceptionGroup`, so `pytest.raises(ValueError)` fails, and `pytest.raises(ExceptionGroup)` hides which error occurred. Fix: `pytest.RaisesGroup(ValueError)` (pytest 8.4+) or `excinfo.group_contains(ValueError)`.
- **Returning instead of asserting**: test functions that `return` a boolean fail since pytest 8.4, while unittest only warns (3.11+) and passes. Fix: assert.
