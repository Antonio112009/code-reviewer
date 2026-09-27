---
name: Async tests (pytest-asyncio, AnyIO, unittest)
description: Async tests that never run or break on loops — no async plugin (failure since pytest 8.4), async def in unittest.TestCase, pytest-asyncio strict-mode decorators, the event_loop fixture removed in 1.0, loop-scope mismatches, sync tests using async fixtures and leaked tasks.
priority: 55
activation:
  content:
    - "\\basync\\s+def\\s+test_?\\w*\\s*\\("
    - "@pytest\\.mark\\.(?:asyncio|anyio|trio)\\b|@pytest_asyncio\\.fixture\\b|\\bpytest_asyncio\\b"
    - "\\bIsolatedAsyncioTestCase\\b|\\bevent_loop\\b|\\bloop_scope\\s*=|\\basyncio_(?:mode|default_\\w+_loop_scope)\\b"
    - "@pytest\\.fixture[^\\n]{0,80}\\r?\\n[ \\t]*async\\s+def\\b"
sources:
  - https://docs.pytest.org/en/stable/changelog.html
  - https://pytest-asyncio.readthedocs.io/en/stable/reference/changelog.html
  - https://docs.pytest.org/en/stable/deprecations.html#sync-test-depending-on-async-fixture
  - https://docs.python.org/3/library/unittest.html#unittest.IsolatedAsyncioTestCase
---
- **No async runner**: since pytest 8.4 an `async def` test without an async plugin fails; in a plain `unittest.TestCase` an `async def test_*` is never awaited and passes (3.11+ only warns). Fix: pytest-asyncio/AnyIO plugin; `IsolatedAsyncioTestCase`.
- **Strict-mode decorators**: pytest-asyncio's default `asyncio_mode = strict` needs `@pytest.mark.asyncio` on tests and `@pytest_asyncio.fixture` on async fixtures (plain `@pytest.fixture` is deprecated there) → coroutine objects instead of values. Fix: the right decorators, or `asyncio_mode = auto`.
- **`event_loop` fixture removed**: pytest-asyncio 1.0 dropped `event_loop`; requesting or overriding it breaks. Fix: `loop_scope=` on marks/fixtures, `asyncio_default_fixture_loop_scope`.
- **Loop-scope mismatch**: a session/module-scoped async fixture (DB pool, HTTP client) used by tests running on per-function loops → "attached to a different loop"/"bound to a different event loop". Fix: the same `loop_scope` for the fixture and its tests.
- **Sync test, async fixture**: requesting an async fixture from a sync test yields an un-awaited coroutine or generator (error since pytest 9.0). Fix: make the test async or wrap the fixture.
- **Leaked tasks**: background tasks started in tests and not cancelled/awaited fail later tests or log "Task was destroyed but it is pending". Fix: cancel and await in teardown; TaskGroups.
- **Sleep-based synchronization**: `await asyncio.sleep(0.1)` to "let things happen" is flaky under load. Fix: await events or conditions; fake clocks (`trio.testing.MockClock`).
