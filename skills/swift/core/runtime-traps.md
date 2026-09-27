---
name: Runtime traps on external data
description: Swift operations that crash the process instead of failing gracefully — force unwraps and casts on external data, integer overflow and numeric conversions, out-of-range access, duplicate dictionary keys, side effects inside assert and unchecked format strings.
priority: 50
tags: [CWE-248, CWE-190, CWE-129]
sources:
  - https://docs.swift.org/swift-book/documentation/the-swift-programming-language/thebasics/#Assertions-and-Preconditions
  - https://docs.swift.org/swift-book/documentation/the-swift-programming-language/advancedoperators/#Overflow-Operators
  - https://developer.apple.com/documentation/swift/dictionary/init(uniquekeyswithvalues:)
---
- **Force unwrap on external data**: `!`, `try!`, `as!` on values from JSON, network, files, user input or `URL(string:)` built from variables → production crash. Fix: `guard let`, `as?`, `do/catch`.
- **Integer overflow**: `+ - *` never wrap — size sums, ms timestamps ×1000, `Int32` counters trap. Fix: wider type, `addingReportingOverflow`, `&+` only when wrapping is intended.
- **Numeric conversion**: `Int(someDouble)` traps on NaN, ±∞ or out-of-range; `Int32(int)` and `UInt(negative)` trap. Fix: `Int(exactly:)`, `Int32(clamping:)`.
- **Out of range**: `array[0]`, `first!`, `removeFirst()` on empty collections, `index(_:offsetBy:)` past the end, `a..<b` with `a > b` → trap. Fix: `first`, `popLast()`, `index(_:offsetBy:limitedBy:)`.
- **Duplicate keys**: `Dictionary(uniqueKeysWithValues:)` over server or user data traps on the first duplicate. Fix: `Dictionary(_:uniquingKeysWith:)`.
- **Work inside assert**: `assert(cache.save())` — the condition isn't evaluated in optimized builds, so the side effect vanishes in release. Fix: do the work outside; `precondition` for invariants.
- **Unchecked format specifiers**: `String(format:)`, `NSLog`, `NSPredicate(format:)` don't type-check arguments — `%@` with an `Int` crashes, `%d` truncates 64-bit values. Fix: interpolation, `%ld`, `as NSNumber`.
