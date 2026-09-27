---
name: Module mocking (Jest and Vitest)
description: Hoisted jest.mock/vi.mock factories, same-module calls that mocks cannot intercept, ESM mocking limits, mock state leaking between tests and reset/restore semantics that differ between Jest and Vitest versions.
priority: 55
activation:
  content:
    - '\b(?:jest|vi)\.(?:mock|doMock|unmock|hoisted|spyOn|mocked|unstable_mockModule|requireActual|importActual|importMock)\b'
    - '\b(?:jest|vi)\.(?:restoreAllMocks|resetAllMocks|clearAllMocks|stubEnv|stubGlobal)\s*\('
    - '\.mock(?:Reset|Restore|Clear|Implementation|ReturnValue|ResolvedValue|RejectedValue)\w*\s*\('
    - '\b(?:clearMocks|resetMocks|restoreMocks|unstubEnvs|unstubGlobals)\s*:'
sources:
  - https://jestjs.io/docs/jest-object#jestmockmodulename-factory-options
  - https://jestjs.io/docs/ecmascript-modules#module-mocking-in-esm
  - https://vitest.dev/api/vi.html#vi-mock
  - https://vitest.dev/guide/migration.html
---
- **Hoisted factories**: `jest.mock`/`vi.mock` run before all imports, so factories can't use file-level variables (Jest allows `mock`-prefixed names, still TDZ-prone; Vitest needs `vi.hoisted`); Vitest 5 throws for `vi.mock` inside `describe`/`test`. Fix: top-level calls; `doMock` + dynamic import.
- **Same-module calls aren't intercepted**: mocking or spying an export doesn't affect other functions in that module that call it → the real dependency (network, DB) still runs, or the spy sees zero calls. Fix: move the dependency to another module or inject it.
- **ESM limits**: `jest.mock` doesn't apply to native ESM (use `jest.unstable_mockModule`, then `await import()`); `vi.mock` ignores `require()`; modules already imported by setup files stay unmocked.
- **Reset semantics differ**: Jest `mockReset` leaves an `undefined`-returning mock, Vitest's restores the `vi.fn(impl)` implementation; `restoreAllMocks` only restores `spyOn` spies (Vitest ≥4 leaves automocks alone). Fix: re-check call-count and return assertions after migrating.
- **State leaking between tests**: `mockReturnValue`/`mockImplementation`, spies on globals and `vi.stubEnv`/`vi.stubGlobal` persist into later tests → order-dependent results. Fix: `restoreMocks: true`, `unstubEnvs`/`unstubGlobals`, or reset in `afterEach`.
- **Constructors in Vitest ≥4**: mocks called with `new` now construct instances, so arrow-function implementations throw "is not a constructor". Fix: `function` or `class` implementations.
