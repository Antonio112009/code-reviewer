---
name: Numbers, money and rounding
description: float money, Decimal from float, banker's rounding in round() and quantize(), floor division/modulo of negatives, bool as int, NaN/inf from user input and the 4,300-digit int/str limit (3.11+).
priority: 57
activation:
  content:
    - "\\b(?:Decimal|Fraction)\\s*\\(|\\bquantize\\s*\\(|\\bROUND_\\w+"
    - "(?<![\\w.])round\\s*\\("
    - "\\bmath\\.(?:floor|ceil|trunc|fmod|isclose|isfinite|isnan|fsum)\\b"
    - "\\bfloat\\s*\\("
    - "\\bset_int_max_str_digits\\b"
    - "\\bisinstance\\s*\\([^)\\n]{1,80}\\bint\\b"
  examples:
    - 'total = Decimal("19.99")'
    - 'price = round(total, 2)'
    - 'if not math.isfinite(value):'
    - 'amount = float(raw)'
    - 'sys.set_int_max_str_digits(0)'
    - 'if isinstance(quantity, int):'
sources:
  - https://docs.python.org/3/library/functions.html#round
  - https://docs.python.org/3/library/decimal.html
  - https://docs.python.org/3/reference/expressions.html#binary-arithmetic-operations
  - https://docs.python.org/3/library/stdtypes.html#int-max-str-digits
---
- **Money in floats**: float prices and balances accumulate binary error (`round(2.675, 2) == 2.67`) → off-by-a-cent totals. Fix: `Decimal` built from strings, or integer cents.
- **`Decimal(float)`**: `Decimal(0.1)` keeps the float's binary error, and `Decimal + float` raises TypeError. Fix: `Decimal("0.1")`/`Decimal(str(x))`; trap `FloatOperation`.
- **Banker's rounding**: `round()` and `quantize()` (context `ROUND_HALF_EVEN`) round halves to even (`round(2.5) == 2`) → totals differ from half-up invoice/tax rules. Fix: `quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)`.
- **Floor semantics**: `//` and `%` floor toward negative infinity while `int()` truncates toward zero → wrong offsets and buckets for negatives. Fix: `math.trunc`/`math.fmod`.
- **`bool` is an `int`**: `isinstance(True, int)` is true → JSON `true` passes as a quantity or id. Fix: reject `bool` first.
- **NaN/inf from input**: `float("nan")`, `float("inf")` and `Decimal("NaN")` parse fine; NaN makes every comparison false and poisons sums. Fix: `math.isfinite()` after parsing.
- **Huge integer strings**: `int(s)`/`str(n)` beyond 4300 digits raise ValueError (3.11+ and 3.7-3.10 security releases, CVE-2020-10735), also inside `json.loads`. Fix: cap input length; never `sys.set_int_max_str_digits(0)` for untrusted data.
