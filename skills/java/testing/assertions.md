---
name: Assertions that assert nothing
description: AssertJ and JUnit assertion mistakes that make tests pass vacuously or compare the wrong thing — assertThat without a terminal check, descriptions/comparators set after the assertion, SoftAssertions without assertAll, and array, BigDecimal and double equality.
priority: 50
activation:
  content:
    - '\bassertThat\('
    - '\bSoftAssertions\b|\bassertSoftly\('
    - '\bassert(?:Equals|NotEquals|True|False|Same|ArrayEquals)\('
    - '\.(?:as|describedAs|withFailMessage|overridingErrorMessage|usingComparator|usingRecursiveComparison)\('
sources:
  - https://assertj.github.io/doc/
  - https://docs.junit.org/current/api/org.junit.jupiter.api/org/junit/jupiter/api/Assertions.html
---
- **No terminal assertion**: `assertThat(result.isValid());` or `assertThat(a.equals(b));` creates an assertion object but checks nothing → always passes. Fix: `assertThat(result.isValid()).isTrue()`, `assertThat(a).isEqualTo(b)`.
- **Configured too late**: `as()`/`describedAs()`, `withFailMessage()` or `usingComparator()` called after `isEqualTo(...)` are ignored — the comparator never applies. Fix: configure before the assertion.
- **Soft assertions never evaluated**: `new SoftAssertions()` without `assertAll()` (outside `assertSoftly` or `SoftAssertionsExtension`) → collected failures are never reported. Fix: `assertAll()` or `assertSoftly`.
- **Wrong equality**: `assertEquals(array1, array2)` compares references; `BigDecimal` `isEqualTo`/`assertEquals` compare scale (`1.0` ≠ `1.00`); exact `double` equality flakes on rounding. Fix: `assertArrayEquals`/`containsExactly`, `isEqualByComparingTo`, `isCloseTo`/deltas.
- **Blind recursive comparison**: over-broad `usingRecursiveComparison().ignoringFields(...)`/`ignoringActualNullFields()`, or `isEqualTo` on objects without `equals` (identity) → assertions that miss real differences or can never pass. Fix: compare the relevant fields explicitly.
