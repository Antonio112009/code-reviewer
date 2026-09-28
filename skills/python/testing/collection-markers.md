---
name: Test collection, parametrize and marks
description: Tests that silently don't run or never fail — generators in parametrize (deprecated 9.1), non-strict xfail, misspelled marks without --strict-markers, uncollected Test classes, module-level skips, duplicate parametrize ids and shared mutable params.
priority: 50
activation:
  content:
    - "@pytest\\.mark\\.\\w+|\\bpytest\\.param\\s*\\(|\\bpytestmark\\b"
    - "\\b(?:xfail|skipif|importorskip)\\b|\\bpytest\\.skip\\s*\\("
    - "^class\\s+Test\\w*|\\b__test__\\b"
    - "\\b(?:xfail_strict|strict_xfail|strict_markers|--strict-markers)\\b"
  examples:
    - '@pytest.mark.slow'
    - '@pytest.mark.xfail(strict=True)'
    - 'class TestUser:'
    - 'strict_markers = True'
sources:
  - https://docs.pytest.org/en/stable/deprecations.html#non-collection-iterables-in-pytest-mark-parametrize
  - https://docs.pytest.org/en/stable/how-to/skipping.html
  - https://docs.pytest.org/en/stable/how-to/mark.html
  - https://docs.pytest.org/en/stable/explanation/goodpractices.html#conventions-for-python-test-discovery
---
- **Generators in `parametrize`**: generators or iterators as `argvalues` are exhausted after the first use → class-level parametrize or repeated collection silently skips tests (deprecated in pytest 9.1). Fix: `list(...)`.
- **Non-strict xfail**: `xfail` without `strict=True` reports an unexpected pass as success → a fixed bug keeps its xfail and later regressions hide behind it. Fix: `strict=True`, or `xfail_strict`/`strict_xfail` (pytest 9 `strict` mode).
- **Misspelled marks**: unknown marks such as `@pytest.mark.slwo`, `@pytest.mark.skipIf` or `@pytest.mark.usefixture` only warn and do nothing (only `parametrize` misspellings fail) → tests silently run unmarked. Fix: `--strict-markers`/`strict_markers`, registered marks.
- **Uncollected test classes**: `Test*` classes with an `__init__` are skipped with only a warning, and methods without the `test` prefix never run. Fix: no `__init__` in test classes.
- **Module-level skipping**: `pytest.skip()` at module scope is a collection error unless `allow_module_level=True`; bare `try: import x` guards turn missing dependencies into silently absent tests. Fix: `pytestmark = pytest.mark.skipif(..., reason=...)`, `pytest.importorskip`.
- **Duplicate ids**: identical parametrize ids are auto-suffixed, hiding duplicated cases (an error with pytest 9 `strict_parametrization_ids`). Fix: unique `ids=`.
- **Shared mutable params**: one list/dict reused across parametrize cases is mutated by one test and seen by the next. Fix: fresh objects per case.
