---
name: Money and numeric precision
description: Binary floating point for money, Decimal initialised from float literals, locale-dependent number parsing, remainder sign in wrap-around math and currency formatted with the device's locale instead of the amount's.
activation:
  content:
    - '\b(?:Decimal|NSDecimalNumber|NumberFormatter|NSNumber)\b|\.formatted\(\.(?:number|currency|percent)\b|\.currency\(code:'
    - '\b(?:price|amount|balance|subtotal|total(?:Price|Amount|Cost)|currency|money|cents|fees?|tax)(?:[A-Z]\w*)?\s*[:=]'
    - '\b(?:Double|Float)\(\s*\w+(?:\.text)?\s*\)'
  examples:
    - 'let total: Decimal = 19.99'
    - 'let amount = Double(priceField.text) ?? 0'
    - 'let label = value.formatted(.currency(code: "USD"))'
sources:
  - https://developer.apple.com/documentation/foundation/decimal
  - https://github.com/swiftlang/swift/issues/45905
  - https://developer.apple.com/documentation/foundation/numberformatter
---
- **Money in Double/Float**: prices, balances and totals in binary floating point → `0.1 + 0.2 != 0.3`, drifting sums, failed equality and off-by-one-cent rounding. Fix: `Decimal` or integer minor units.
- **Decimal from a float literal**: `Decimal(0.1)`, `let d: Decimal = 19.99` or `Decimal(someDouble)` go through `Double` → `0.1000000000000000512`. Fix: `Decimal(string:locale:)` with `en_US_POSIX`, or build from integer cents.
- **Locale-dependent parsing**: `NumberFormatter` and `FormatStyle` default to the user's locale → server values like `"1.5"` fail or misparse on a `de_DE` device, while `Double("1,5")` is `nil`. Fix: `en_US_POSIX` for machine data; user locale only for input and display.
- **Remainder sign**: `%` keeps the dividend's sign (`-1 % 7 == -1`) → negative indices in wrap-around, ring-buffer or weekday math. Fix: `((a % n) + n) % n`.
- **Device currency for server amounts**: formatting an amount with `Locale.current`'s currency or a formatter's default currency code → wrong symbol and fraction digits (JPY has none). Fix: pass the amount's ISO currency code.
