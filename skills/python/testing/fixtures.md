---
name: pytest fixtures
description: Fixture pitfalls — mutable shared session/module fixtures, teardown skipped or missing, class-scoped fixtures on self (deprecated 9.1), marks on fixtures (error since pytest 9.0), hidden autouse fixtures and shadowed fixture names.
priority: 52
activation:
  content:
    - "@pytest\\.fixture\\b|@pytest_asyncio\\.fixture\\b"
    - "\\bscope\\s*=\\s*[\"'](?:session|package|module|class)[\"']|\\bautouse\\s*=\\s*True\\b"
    - "\\baddfinalizer\\s*\\(|\\bgetfixturevalue\\s*\\("
  examples:
    - '@pytest.fixture'
    - '@pytest.fixture(scope="session")'
    - 'request.addfinalizer(cleanup)'
sources:
  - https://docs.pytest.org/en/stable/how-to/fixtures.html
  - https://docs.pytest.org/en/stable/deprecations.html
  - https://docs.pytest.org/en/stable/changelog.html
---
- **Mutable shared fixtures**: `session`/`module`/`class`-scoped fixtures returning lists, dicts, model objects or rows that tests mutate → order-dependent failures (often only under xdist or random order). Fix: function scope, or copies.
- **Teardown skipped**: code after `yield` doesn't run when setup raised before the `yield`, leaking earlier resources; cleanup at the end of a test body never runs on failure. Fix: one resource per fixture; `request.addfinalizer` right after acquiring.
- **`return` instead of `yield`**: fixtures that start servers, patch globals or open transactions and `return` never clean up. Fix: `yield`, then teardown.
- **Class-scoped fixture on `self`**: a `scope="class"` fixture written as an instance method sets attributes on another instance than the tests get (deprecated in pytest 9.1). Fix: a `@classmethod` fixture setting `cls.` attributes.
- **Marks on fixtures**: `usefixtures`, `parametrize` or `skip` marks on a fixture never had an effect and are an error since pytest 9.0. Fix: mark the tests or request the fixture.
- **Hidden `autouse`**: autouse fixtures in `conftest.py` (DB resets, network blocking, env or clock changes) apply to every test below; widening their scope changes isolation. Fix: minimal, function-scoped.
- **Shadowed fixture names**: a same-named fixture in a nearer `conftest.py` overrides the parent (`db`, `client`, `settings`) → tests use a different setup than assumed. Fix: distinct names.
