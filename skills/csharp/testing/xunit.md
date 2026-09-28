---
name: xUnit lifecycle and parallelism
description: xUnit test-structure defects — async void tests, parallel test collections sharing state, per-test class instances vs fixtures, v3 IAsyncLifetime/IAsyncDisposable changes that skip Dispose, and tests ignoring the v3 cancellation token.
priority: 50
activation:
  content:
    - '\[(?:Fact|Theory|InlineData|MemberData|ClassData|Collection|CollectionDefinition)\b'
    - '\bI(?:Class|Collection)Fixture<|\bIAsyncLifetime\b|\bTestContext\.Current\b|\busing\s+Xunit\b'
    - '\basync\s+void\b'
  examples:
    - '[InlineData(1, 2, 3)]'
    - 'public class OrderTests : IClassFixture<DatabaseFixture>'
    - 'public async void OnClick_Should_SaveOrder()'
sources:
  - https://xunit.net/docs/getting-started/v3/migration
  - https://xunit.net/docs/running-tests-in-parallel
  - https://xunit.net/docs/shared-context
---
- **async void tests**: `async void` test methods can't be awaited reliably by runners — xUnit v3 fails them at runtime, other frameworks may report success before the work finishes. Fix: `async Task`.
- **Parallel collections**: xUnit runs test classes (separate collections) in parallel by default → tests sharing static state, one database, files, ports, environment variables or `CultureInfo.CurrentCulture` interfere and flake. Fix: shared resources in one `[Collection]`, `DisableParallelization`, isolated data per test.
- **Instance per test**: xUnit creates a new class instance for every test — expensive setup in the constructor reruns each time; state written in fixtures (`IClassFixture<T>`/`ICollectionFixture<T>`) leaks between tests. Fix: heavy setup in fixtures, treat them as read-only or reset.
- **v3 disposal changes**: `IAsyncLifetime` now returns `ValueTask` and extends `IAsyncDisposable`; when a fixture implements both `IDisposable` and `IAsyncDisposable`, v3 calls only `DisposeAsync` → cleanup left in `Dispose()` is silently skipped after migrating. Fix: move cleanup into `DisposeAsync`.
- **Cancellation (v3)**: async tests that don't pass `TestContext.Current.CancellationToken` keep running after timeouts or aborts (analyzer xUnit1051). Fix: flow the token.
