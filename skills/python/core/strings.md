---
name: Strings, bytes and text parsing
description: strip() character sets vs affixes, strings used as booleans (env vars, argparse type=bool), isdigit vs int(), str() of bytes, implicit locale encodings (UTF-8 default only from 3.15), split pitfalls and Unicode case-folding.
priority: 57
activation:
  content:
    - "\\.(?:l|r)?strip\\s*\\(\\s*[bfr]?[\"'][^\"'\\n]{2,}[\"']"
    - "\\bbool\\s*\\(\\s*(?:os\\.|request|environ|getenv|value|val\\b|s\\b|arg)|\\btype\\s*=\\s*bool\\b"
    - "\\bos\\.(?:getenv|environ)\\b"
    - "\\.is(?:digit|numeric|decimal)\\s*\\(\\s*\\)"
    - "\\.split\\s*\\(\\s*[\"'] [\"']\\s*\\)"
    - "\\.(?:decode|encode|casefold)\\s*\\(|\\bunicodedata\\b|\\.lower\\s*\\(\\s*\\)\\s*==|\\bstr\\s*\\(\\s*\\w*(?:body|content|data|raw|payload|bytes)\\w*\\s*\\)"
sources:
  - https://docs.python.org/3/library/stdtypes.html#str.strip
  - https://docs.python.org/3/library/argparse.html#type
  - https://docs.python.org/3/library/stdtypes.html#str.isdecimal
  - https://docs.python.org/3.15/whatsnew/3.15.html#other-language-changes
---
- **`strip` is not affix removal**: `rstrip(".json")` or `lstrip("https://")` remove any of those characters → `"users.json".rstrip(".json") == "user"`. Fix: `removesuffix()`/`removeprefix()` (3.9+).
- **Strings as booleans**: `bool("false")`, `if os.getenv("DEBUG"):` and argparse `type=bool` are true for any non-empty string → features enabled by "false". Fix: compare to explicit values; `action="store_true"`.
- **`isdigit()` vs `int()`**: `"²".isdigit()` is true but `int("²")` raises, while `int()` accepts spaces, `_`, signs and non-ASCII digits → validator and parser disagree. Fix: `re.fullmatch(r"[0-9]+", s)`.
- **`str()` of bytes**: `str(b"x")` gives `"b'x'"` → corrupted URLs, headers, keys. Fix: `.decode("utf-8")`.
- **Implicit encodings**: `open()`, `read_text()`, `subprocess(text=True)` without `encoding=` use the locale codec before 3.15 (cp1252 on Windows) and UTF-8 from 3.15 → mojibake, or behaviour changes on upgrade. Fix: `encoding="utf-8"`.
- **`split(" ")`**: keeps empty items for repeated spaces; `"".split(",")` returns `[""]` → phantom fields. Fix: `split()`, filter empties.
- **Case-insensitive identity**: `lower()` comparisons of usernames/emails miss Unicode case rules and compatibility look-alikes → duplicate accounts. Fix: `unicodedata.normalize("NFKC", s).casefold()`.
