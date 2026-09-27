---
name: Assertions that don't assert
description: Test assertions that silently pass — un-awaited async assertions (Assert.ThrowsAsync, FluentAssertions ThrowAsync), sync assertions over async code, tautologies against mocks, catch blocks swallowing failures, lenient BeEquivalentTo and exact float/time comparisons.
priority: 50
activation:
  content:
    - '\bAssert\.\w+(?:<[^>\n]{1,60}>)?\(|\.Should\(\)|\bRecord\.Exception(?:Async)?\('
    - '\b(?:ThrowAsync|ThrowExactlyAsync|NotThrowAsync|CompleteWithinAsync|BeEquivalentTo)\b'
sources:
  - https://xunit.net/xunit.analyzers/rules/xUnit2021
  - https://fluentassertions.com/exceptions/
  - https://fluentassertions.com/objectgraphs/
---
- **Un-awaited async assertions**: `Assert.ThrowsAsync<T>(…)`, `act.Should().ThrowAsync<T>()`, `NotThrowAsync()`, `CompleteWithinAsync()` without `await` → the assertion never completes and the test passes. Fix: `await` every `*Async` assertion.
- **Sync assertion on async code**: `Assert.Throws<T>(() => DoAsync())` or `act.Should().Throw()` on a `Func<Task>` → the exception inside the task isn't observed as intended → wrong pass/fail. Fix: the async variants.
- **Tautologies**: asserting a mock's own setup (`Returns(5)` then `Assert.Equal(5, mock.Object.Get())`), `try { act(); } catch { }` without a failing assert, conditions that can't fail → no coverage of the code under test. Fix: assert the SUT's observable output.
- **Lenient equivalency**: FluentAssertions `BeEquivalentTo` compares only the expectation's members (extra subject members ignored) and ignores collection order by default → wrong or extra data passes. Fix: `WithStrictOrdering()`, explicit member checks, `ExcludingMissingMembers` only deliberately.
- **Exact comparisons**: `Assert.Equal(0.3, 0.1 + 0.2)` or comparing `DateTime.Now` values → flaky failures (or fixes that loosen too much). Fix: precision/tolerance overloads, `BeCloseTo`, controlled clocks.
