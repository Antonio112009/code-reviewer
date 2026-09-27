---
name: JUnit test execution pitfalls
description: Tests that never run or never fail — JUnit 4 tests without the Vintage engine, private/static/non-void @Test methods, lifecycle-method rules, over-broad exception assertions, assertions in other threads, sleeps and order- or time-dependent tests.
priority: 50
activation:
  content:
    - '^[ \t]*import[ \t]+(?:static[ \t]+)?org\.junit\.'
    - '@(?:Test|BeforeAll|AfterAll|BeforeEach|AfterEach|Nested|ParameterizedTest|TestInstance|RepeatedTest)\b'
    - '\bassertThrows\(|\bexpected\s*='
    - '\bThread\.sleep\('
sources:
  - https://docs.junit.org/6.1.3/writing-tests/test-classes-and-methods.html
  - https://docs.junit.org/5.13.4/release-notes/index.html
  - https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-2.4-Release-Notes
---
- **JUnit 4 tests skipped**: `org.junit.Test` classes on the JUnit Platform without `junit-vintage-engine` (dropped from `spring-boot-starter-test` in Boot 2.4) never run. Fix: `org.junit.jupiter.api.Test`.
- **Invalid test methods**: `private`, `static` or non-`void` `@Test` methods are not executed (JUnit 5.13+ only reports a discovery warning). Fix: package-private `void` methods.
- **Lifecycle rules**: `@BeforeAll`/`@AfterAll` must be `static` unless `@TestInstance(PER_CLASS)`; `@Nested` classes must be non-static → otherwise setup or whole groups don't run. Fix: follow the rules; watch test counts.
- **Too-broad exception checks**: `assertThrows(Exception.class, …)` or JUnit 4 `@Test(expected = …)` pass when any statement throws, even setup code or an NPE. Fix: the narrowest type, one call in the lambda, assert the message.
- **Assertions that can't fail**: failures inside executor tasks, `CompletableFuture` callbacks or listener threads aren't propagated; tests that assert only inside a `catch` pass when nothing is thrown. Fix: join futures in the test thread; `assertThrows`.
- **Flaky time and order**: `Thread.sleep` waits, `LocalDate.now()`, `HashMap` order, or reliance on test method order (deterministic but intentionally non-obvious). Fix: Awaitility, an injected `Clock`, independent tests.
- **Parallel execution**: `junit.jupiter.execution.parallel.enabled=true` with shared static fixtures, system properties or singletons → nondeterministic results. Fix: `@ResourceLock`/`@Isolated` or no shared state.
