---
name: Testing Library queries and async
description: waitFor callbacks that never retry or repeat side effects, getBy/queryBy/findBy misuse, un-awaited user-event v14 calls and missing automatic cleanup when the runner has no globals.
priority: 55
activation:
  content:
    - '@testing-library/'
    - '\b(?:screen|within\([^)\n]{0,60}\))\.(?:get|query|find)(?:All)?By\w+\s*\('
    - '\bwaitFor(?:ElementToBeRemoved)?\s*\('
    - '\buserEvent\.\w+\s*\(|\buser\.(?:click|dblClick|type|keyboard|hover|selectOptions|upload|clear|tab|paste)\s*\('
    - '\bfireEvent\.\w+\s*\('
  examples:
    - 'import { screen } from ''@testing-library/react'';'
    - 'screen.getByRole(''button'');'
    - 'await waitFor(() => expect(x).toBe(1));'
    - 'await user.click(button);'
    - 'fireEvent.change(input, { target: { value: ''a'' } });'
sources:
  - https://testing-library.com/docs/dom-testing-library/api-async
  - https://testing-library.com/docs/queries/about#types-of-queries
  - https://testing-library.com/docs/user-event/intro
  - https://testing-library.com/docs/react-testing-library/api#cleanup
---
- **`waitFor` needs a throw**: returning a falsy value doesn't trigger a retry - `await waitFor(() => screen.queryByText('Saved'))` resolves at once with `null` and the test passes vacuously. Fix: `expect(…)` inside the callback, or `await screen.findByText(…)`.
- **Side effects inside `waitFor`**: clicks, dispatches or mock setup in the callback run on every retry (50 ms interval, 1 s default timeout) → duplicated actions. Fix: act before `waitFor`; only assert inside it.
- **Wrong query type**: `getBy*` throws immediately for elements that appear asynchronously (use `findBy*`); asserting absence with `getBy*` throws before the assertion (use `queryBy*` + `not.toBeInTheDocument()`); `waitForElementToBeRemoved` throws if the element isn't there initially.
- **user-event v14 is async**: `user.click()`/`type()` return promises; without `await`, assertions run before handlers and state updates (flaky results, act warnings). Fix: `const user = userEvent.setup()` before rendering, then `await user.click(…)`.
- **No automatic cleanup**: Testing Library unmounts after each test only when the runner exposes a global `afterEach`; Vitest's default `globals: false` doesn't → the DOM accumulates, queries find duplicates, components keep running. Fix: `globals: true` or `afterEach(cleanup)` in a setup file.
