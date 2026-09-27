---
name: unittest.mock and monkeypatch
description: Mocking pitfalls — patching where defined instead of where looked up, mocks without spec, assertion typos passing silently (before 3.12), MagicMock for async code, stacked @patch argument order, side_effect/return_value mix-ups and leaked patches.
priority: 52
activation:
  content:
    - "\\bmock\\.patch\\b|@patch\\b|(?<![\\w.])patch(?:\\.object|\\.dict)?\\s*\\(|\\bmocker\\.patch\\b|\\bmonkeypatch\\.setattr\\s*\\("
    - "\\b(?:Magic|Async|NonCallableMagic)?Mock\\s*\\(|\\bcreate_autospec\\s*\\("
    - "\\.(?:called_once_with|called_with|has_calls|not_called)\\s*\\(|\\bassert_\\w+\\s*\\("
sources:
  - https://docs.python.org/3/library/unittest.mock.html#where-to-patch
  - https://docs.python.org/3/library/unittest.mock.html#autospeccing
  - https://docs.python.org/3/library/unittest.mock.html#unittest.mock.AsyncMock
  - https://github.com/python/cpython/issues/100690
---
- **Patching the wrong name**: `patch("pkg.utils.send")` doesn't affect modules that did `from pkg.utils import send`; patch where it is looked up (`patch("pkg.orders.send")`), same for `monkeypatch.setattr` → real emails or HTTP calls run in tests.
- **Mocks without spec**: `Mock()`/`MagicMock()` accept any attribute and signature → tests pass after renames and signature changes. Fix: `autospec=True`, `create_autospec`, `spec_set=`.
- **Assertion typos**: `mock.called_once_with(...)`, `assert mock.has_calls(...)` or `mock.assert_called_once` without parentheses check nothing (AttributeError for such names only since 3.12). Fix: `mock.assert_called_once_with(...)`.
- **Async targets**: a `MagicMock` for an async function returns a non-awaitable, and `assert_called` passes even if the coroutine was never awaited. Fix: `AsyncMock`, `assert_awaited_once_with`.
- **Stacked `@patch` order**: decorators inject mocks bottom-up → swapped parameters configure the wrong mock. Fix: reverse the parameter order, or `with patch(...)`.
- **`return_value` vs `side_effect`**: configuring the class instead of `MockCls.return_value`, or an exhausted `side_effect` list (StopIteration), yields Mocks-returning-Mocks and false passes. Fix: assert on received values.
- **Leaked patches**: `patcher.start()` without `stop()`/`addCleanup`, or assigning module globals and `os.environ` directly, leaks into later tests. Fix: `with patch`, `monkeypatch`, `patch.dict(os.environ, …)`.
