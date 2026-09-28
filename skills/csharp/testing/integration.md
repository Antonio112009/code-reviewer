---
name: Integration tests
description: Integration-test defects — EF Core InMemory provider standing in for a relational database, shared database state across parallel tests, WebApplicationFactory running in Development, disabled authorization in test hosts, real external calls and wall-clock time/sleeps.
priority: 50
activation:
  content:
    - '\bWebApplicationFactory<|\bConfigure(?:Test)?Services\(|\bUseEnvironment\(|\bUseInMemoryDatabase\('
    - '\bTestcontainers\b|\b(?:PostgreSql|MsSql|MySql|Redis)Container\b|\bRespawner\b'
    - '\bFakeTimeProvider\b|\bThread\.Sleep\(|\bTask\.Delay\(|\bDateTime\.(?:Now|UtcNow)\b'
  examples:
    - 'public class ApiFactory : WebApplicationFactory<Program> { }'
    - 'await using var db = new PostgreSqlContainer().WithImage("postgres:16").Build();'
    - 'var createdAt = DateTime.UtcNow;'
sources:
  - https://learn.microsoft.com/en-us/ef/core/testing/choosing-a-testing-strategy
  - https://learn.microsoft.com/en-us/ef/core/providers/in-memory/
  - https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests
  - https://learn.microsoft.com/en-us/dotnet/standard/datetime/timeprovider-overview
---
- **InMemory provider**: `UseInMemoryDatabase` has no relational behaviour — no transactions, FK/unique constraints, raw SQL, collation or translation errors → green tests, failing production; Microsoft discourages it for testing. Fix: the real provider in a container, or SQLite in-memory with known differences.
- **Shared database state**: tests writing to one database without isolation (rollback, reset, unique data) plus parallel test collections → order-dependent, flaky results. Fix: per-test transactions or resets; run DB tests in one collection.
- **Development environment**: `WebApplicationFactory` runs the app in `Development` unless changed → developer exception page, relaxed CORS and dev settings mask production behaviour. Fix: `builder.UseEnvironment(...)` and explicit test configuration.
- **Authorization switched off**: test hosts that register an allow-all policy or an auth handler granting admin to every request → authorization bugs never tested. Fix: realistic identities, including negative (403/401) cases.
- **External calls**: tests hitting real third-party APIs, e-mail or payment sandboxes → flaky, slow, costly side effects. Fix: stub `HttpMessageHandler` or a local fake server.
- **Wall-clock time**: `DateTime.Now`, `Thread.Sleep`, `Task.Delay` in tests or code under test → slow, time-zone- and timing-dependent flakiness. Fix: inject `TimeProvider` (.NET 8+), advance `FakeTimeProvider` in tests.
