---
name: Fake timers
description: Fake timers vs pending promises, which APIs Jest, Vitest and node:test fake, fake time leaking into other tests, runAllTimers loop limits and Testing Library waits under Vitest fake timers.
priority: 55
activation:
  content:
    - '\b(?:jest|vi)\.(?:useFakeTimers|useRealTimers|advanceTimersByTime|advanceTimersToNextTimer|runAllTimers|runOnlyPendingTimers|setSystemTime|runAllTicks)\w*\b'
    - '\bmock\.timers\.\w+\s*\(|\bfakeTimers\s*:|\bshouldAdvanceTime\b'
  examples:
    - 'vi.useFakeTimers();'
    - 'mock.timers.enable({ apis: [''setTimeout''] });'
sources:
  - https://jestjs.io/docs/jest-object#fake-timers
  - https://vitest.dev/config/faketimers
  - https://nodejs.org/api/test.html#class-mocktimers
  - https://github.com/testing-library/dom-testing-library/blob/main/src/helpers.ts
---
- **Timers vs promises**: `advanceTimersByTime`/`runAllTimers` fire timers synchronously, but code that awaits between timers (retries with backoff, `await sleep()`) needs microtasks in between → it never progresses and the test times out or asserts too early. Fix: the `…Async` variants (`advanceTimersByTimeAsync`).
- **What gets faked differs**: Jest's modern timers also fake `Date`, `queueMicrotask`, `nextTick` and `performance`; Vitest fakes everything except `nextTick` and `queueMicrotask` (plus `Temporal` since v5); `node:test` fakes only the `apis` passed to `mock.timers.enable()`. Fix: list faked APIs explicitly when porting tests.
- **Leaking fake time**: `useFakeTimers()`/`setSystemTime()` without `useRealTimers()` in `afterEach` → later tests hang on timeouts or see a frozen clock; the top-level `mock` of `node:test` isn't restored automatically (use `t.mock`). Fix: restore in `afterEach`.
- **Endless timers**: `runAllTimers()` with recursive `setTimeout` or `setInterval` hits the loop limit (Jest 100 000, Vitest 10 000) and throws. Fix: `runOnlyPendingTimers()` or advance a bounded time.
- **Testing Library under Vitest fake timers**: `waitFor`/`findBy*` advance fake timers only when a global `jest` exists → with Vitest they hang until the test timeout; user-event delays hang too. Fix: `vi.useFakeTimers({ shouldAdvanceTime: true })`, `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.
