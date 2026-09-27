---
name: GORM queries, errors and SQL injection
description: Unchecked .Error results, ErrRecordNotFound versus Find, string arguments treated as SQL, unescaped Order/Select/Group/Raw input, and N+1 or unbounded loads.
priority: 68
tags: [CWE-89, CWE-252, CWE-400]
activation:
  content:
    - '\.(?:First|Take|Last|Find|Where|Order|Group|Having|Joins|Select|Raw|Exec|Table|Pluck|Preload|Distinct)\('
    - '\bErrRecordNotFound\b'
    - '\.Error\b'
sources:
  - https://gorm.io/docs/security.html
  - https://gorm.io/docs/query.html
  - https://gorm.io/docs/error_handling.html
  - https://gorm.io/docs/preload.html
---
- **Errors live on the chain**: `db.First(&u, id)` without checking `.Error` (or `result.Error`) continues with a zero struct as if found; errors in chained calls are not returned. Fix: `if err := db.….Error; err != nil`.
- **Not found**: `First/Take/Last` return `gorm.ErrRecordNotFound`, `Find` never does (empty slice or zero struct) → existence checks written with `Find` always "succeed". Fix: `errors.Is(err, gorm.ErrRecordNotFound)` or check `RowsAffected`.
- **Strings become SQL**: `db.First(&u, idFromRequest)`/`Find(&u, s)` with a string argument treat it as a raw condition → SQL injection. Fix: convert to a number (`strconv`) or `First(&u, "id = ?", s)`.
- **Unescaped builders**: user input in `Where(fmt.Sprintf(…))`, `Order`, `Select`, `Group`, `Having`, `Joins`, `Table`, `Distinct`, `Pluck`, `Raw` or `Exec` strings is not escaped. Fix: `?` placeholders; allowlist columns (`clause.OrderByColumn`).
- **N+1 and unbounded loads**: association fields loaded per row in loops, `Find(&all)` without `Limit`, `Preload` of large has-many sets → query storms and OOM. Fix: `Preload`/`Joins`, pagination, `FindInBatches`.
