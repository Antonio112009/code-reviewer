---
name: Test quality
description: Tests that cannot fail or never run, unawaited assertions, loose error checks, tautologies, over-mocking, routing bypassed, skipped or weakened tests, flakiness, state leakage and test-only branches in production code.
category: practice
priority: 48
tier: full
activation:
  files:
    - "**/*.{test,spec,cy}.*"
    - "**/{__tests__,__mocks__,__snapshots__,test,tests,spec,e2e,cypress}/**"
    - "**/{test_*,*_test}.py"
    - "**/{conftest.py,pytest.ini}"
    - "**/*_test.{go,exs,dart}"
    - "**/*_{test,unittest}.{cc,cpp}"
    - "**/*{Test,Tests,Spec,IT}.{java,kt,cs,scala,groovy,swift,php}"
    - "**/*_spec.rb"
    - "**/{jest,vitest,playwright,cypress,karma}.config.*"
    - "**/phpunit.xml*"
  content:
    - (?<![\w.$])(?:describe|it|test)(?:\.(?:only|skip|each|todo|concurrent|fails))?\(\s*['"`]|(?<![\w.$])(?:xit|xdescribe|fit|fdescribe)\(
    - \bdef\s+test_\w*\(|@pytest\.(?:fixture|mark)\b|\bunittest\.TestCase\b
    - "@(?:Test|ParameterizedTest|Disabled|Ignore)\\b|\\[(?:Fact|Theory|Test|TestMethod|Ignore)\\b|\\bfunc\\s+Test\\w*\\(\\s*t\\s+\\*testing\\.T\\)|#\\[(?:tokio::)?test\\b"
    - \bNODE_ENV\s*[!=]==?\s*['"]test['"]|\bprocess\.env\.(?:VITEST|JEST_WORKER_ID)\b|\bsettings\.TESTING\b|\[['"]TESTING['"]\]|\bIS_TEST(?:ING)?\b|\btesting\.Testing\(\)|\bRails\.env\.test\?
  examples:
    - 'it("returns 404 when missing", async () => {'
    - 'def test_login_rejects_bad_password():'
    - 'func TestCreateUser(t *testing.T) {'
    - 'if (process.env.VITEST) { seedDatabase(); }'
---
- **Cannot fail**: no assertion; assertions in callbacks, `.then` or goroutines never awaited; `expect(x)` without a matcher; `assert (cond, "msg")`; assertions only in `catch` → passes vacuously. Fix: `expect.assertions(n)`, await.
- **Unawaited assertions**: `expect(p).rejects`/`resolves`, Playwright `expect(locator)` matchers, `act`, user-event or `waitFor` without `await` → the test ends before the check runs. Fix: await each one.
- **Loose throw check**: bare `toThrow()`, `pytest.raises(Exception)` or `assertThrows(Exception.class)` accept any error, even a typo's TypeError; `raises` blocks spanning several statements → false green. Fix: assert type and message.
- **Tautology**: expectations computed by the code under test, asserting a stub's own return, snapshots re-recorded with the bug → proves nothing. Fix: independent literals; review snapshot diffs.
- **Over-mocking**: mocking the unit under test or the function just changed; mocks drifting from real signatures (`Mock()` without `spec`, `as any` fakes); call-count asserts ignoring a new argument → green tests, broken production. Fix: mock boundaries, `autospec`, assert arguments.
- **Never collected**: file outside the runner's `include`/`testMatch` (`*.tests.ts`), missing `test_` prefix, JUnit 4 `@Test` under JUnit 5, private test methods → tests silently never run. Fix: follow runner naming.
- **Skipped or weakened**: leftover `.only`, new `skip`/`xit`/`@Disabled`/`t.Skip()`, env-conditional early returns, deleted tests, loosened matchers or expectations edited to match output → regression locked in. Fix: restore or justify.
- **Flakiness**: real clock, `sleep`-based waits, DST/month-end dates, unseeded randomness, live network, unordered results asserted in order, state leaking between tests (DB rows, env, spies) → intermittent failures. Fix: fake clocks, seeds, per-test reset.
- **Test-only branches**: production code checking `NODE_ENV === "test"`, `settings.TESTING` or `testing.Testing()` to skip auth, validation or signatures → tests cover a path production never runs; a leaked flag disables checks. Fix: inject dependencies.
- **Routing bypassed**: views or actions called directly (Django `RequestFactory`; Rails controller tests ignore the HTTP verb) pass for requests the router rejects → green tests, unreachable endpoint. Fix: request tests.
