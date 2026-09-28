---
tier: full
name: Coroutine tests
description: kotlinx-coroutines-test pitfalls — Main dispatcher not replaced, real delays on IO/Default, StandardTestDispatcher work not run before assertions, infinite collectors blocking runTest, separate schedulers and deprecated runBlockingTest APIs.
priority: 55
activation:
  files: ["**/src/test/**", "**/src/androidTest/**", "**/src/*Test/**", "**/*Test.kt", "**/*Tests.kt"]
  content:
    - '\brunTest\b'
    - '\b(?:Standard|Unconfined)TestDispatcher\b'
    - '\bDispatchers\.(?:setMain|resetMain)\b'
    - '\b(?:runBlockingTest|TestCoroutineDispatcher|TestCoroutineScope)\b'
    - '\b(?:advanceUntilIdle|advanceTimeBy|runCurrent|backgroundScope)\b'
  examples:
    - 'fun test() = runTest { viewModel.load() }'
    - 'val dispatcher = StandardTestDispatcher(testScheduler)'
    - 'Dispatchers.setMain(testDispatcher)'
    - 'val scope = TestCoroutineScope()'
    - 'advanceUntilIdle()'
sources:
  - https://github.com/Kotlin/kotlinx.coroutines/blob/master/kotlinx-coroutines-test/README.md
  - https://developer.android.com/kotlin/coroutines/test
---
- **Main not replaced**: code using `Dispatchers.Main`/`viewModelScope` in JVM unit tests without `Dispatchers.setMain(testDispatcher)` (and `resetMain()` after) → `IllegalStateException` or cross-test leakage. Fix: a Main-dispatcher JUnit rule/extension.
- **Real time on IO/Default**: `withContext(Dispatchers.IO/Default)` in the code under test ignores virtual time → `delay` really waits, tests slow or flaky. Fix: inject dispatchers and pass `StandardTestDispatcher(testScheduler)`.
- **Work not executed**: with `StandardTestDispatcher`, launched coroutines run only after `advanceUntilIdle()`/`runCurrent()` → assertions check the initial state and pass vacuously. Fix: advance before asserting.
- **Infinite collectors**: collecting a `StateFlow`/`SharedFlow` in `launch {}` inside `runTest` never finishes → the 60 s `runTest` timeout (1.8+) fails the test. Fix: `backgroundScope.launch { … }`.
- **Separate schedulers**: several `StandardTestDispatcher()` without the shared `testScheduler` keep separate clocks → `advanceTimeBy` doesn't move the code's delays. Fix: pass `testScheduler` to every test dispatcher.
- **Deprecated APIs**: `runBlockingTest`, `TestCoroutineDispatcher`, `TestCoroutineScope` are deprecated (levels raised again in 1.11) and have different eager semantics → migrate to `runTest` rather than mixing both.
