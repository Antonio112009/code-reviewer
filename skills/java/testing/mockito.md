---
name: Mockito misuse
description: Mockito pitfalls that hide bugs — stubbing spies with when(), typed matchers that don't match null, silent @InjectMocks failures, verify without a method call, leaked static and construction mocks, and dynamic agent loading on JDK 21+.
priority: 50
activation:
  content:
    - '^[ \t]*import[ \t]+(?:static[ \t]+)?org\.mockito\.'
    - '@(?:Mock|Spy|InjectMocks|Captor|MockitoBean|MockitoSpyBean)\b'
    - '\b(?:when|verify|doReturn|mockStatic|mockConstruction|spy)\('
sources:
  - https://site.mockito.org/javadoc/current/org/mockito/Mockito.html
  - https://openjdk.org/jeps/451
---
- **Stubbing spies with when()**: `when(spy.load())` calls the real method while stubbing (side effects, exceptions). Fix: `doReturn(x).when(spy).load()`.
- **Matchers vs null**: `any(Foo.class)`, `anyString()`, `anyList()` don't match `null` (Mockito 2+) → the stub silently returns defaults (`null`, 0, empty) and the test exercises another path. Fix: `any()`, `nullable(Foo.class)` or exact values.
- **Silent @InjectMocks**: when constructor, setter or field injection fails, Mockito reports nothing → collaborators stay null or real. Fix: construct the object under test explicitly.
- **verify without a call**: `verify(mock);` with no method invoked on the result verifies nothing. Fix: `verify(mock).foo(expected)` with specific arguments.
- **Leaked static mocks**: `mockStatic(...)`/`mockConstruction(...)` without closing the returned `MockedStatic`/`MockedConstruction` keeps the mock active on that thread → unrelated tests break. Fix: try-with-resources.
- **Agents on JDK 21+**: Mockito 5's default inline mock maker self-attaches a Java agent → warnings now, failures once dynamic loading is disallowed (JEP 451). Fix: add Mockito as a `-javaagent` to the Surefire/Gradle test JVM.
