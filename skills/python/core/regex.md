---
name: Regular expressions (re)
description: re pitfalls — match() and $ in validation, flags passed positionally as count/maxsplit (deprecated 3.13), Unicode \d/\w, unescaped input in patterns and replacements, catastrophic backtracking without timeouts and group-shaped findall/split results.
priority: 57
tags: [CWE-185, CWE-1333]
activation:
  content:
    - "\\bre\\.(?:match|search|fullmatch|sub|subn|split|findall|finditer|compile)\\s*\\("
    - "\\bregex\\.\\w+\\s*\\("
    - "\\.(?:fullmatch|finditer)\\s*\\("
sources:
  - https://docs.python.org/3/library/re.html#re.fullmatch
  - https://docs.python.org/3/library/re.html#re.sub
  - https://docs.python.org/3/library/re.html#regular-expression-syntax
  - https://pypi.org/project/regex/
---
- **`match` is not validation**: `re.match()` anchors only at the start and `$` also matches before a trailing newline (`"admin\n"` passes `^admin$`) → validation bypass. Fix: `re.fullmatch()` or `\A...\Z`.
- **Flags passed as count**: `re.sub(p, r, s, re.I)` and `re.split(p, s, re.M)` pass the flag as `count`/`maxsplit` → case-sensitive match plus a replacement limit (positional use deprecated in 3.13). Fix: `flags=re.I`.
- **Unicode classes**: for str patterns `\d`, `\w`, `\s` match all Unicode digits, letters and spaces → non-ASCII digits pass numeric checks. Fix: `[0-9]` or `re.ASCII`.
- **Unescaped input in patterns**: `re.search(term, text)` or `f"^{name}$"` with user/data values lets `.`, `+`, `(` change meaning → wrong matches, `re.error`, ReDoS. Fix: `re.escape(value)`.
- **Catastrophic backtracking**: nested quantifiers like `(a+)+` or `(\w+\s?)*$` on untrusted input can run for minutes; `re` has no timeout. Fix: unambiguous patterns, length caps, atomic groups (3.11+) or `regex` with `timeout=`.
- **User text as replacement**: `re.sub(p, user_text, s)` interprets backslashes and group references in it. Fix: `re.sub(p, lambda m: user_text, s)`.
- **Group-shaped results**: with capturing groups `re.findall` returns groups, not whole matches, and `re.split` keeps separators → shifted fields. Fix: `(?:...)`.
