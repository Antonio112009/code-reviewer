---
name: Strings, encodings and PCRE
description: Byte vs multibyte string functions, ASCII-only case folding (8.2), empty needles, and preg_* failure values, `$` before a trailing newline, the u modifier, preg_quote delimiters and PCRE2 changes in 8.4.
priority: 58
tags: [CWE-176, CWE-625, CWE-252]
activation:
  content:
    - '\b(?:strlen|substr|str_pad|strrev|wordwrap|str_split|strtolower|strtoupper|ucfirst|ucwords|stripos|str_ireplace)\s*\('
    - '\b(?:str_contains|str_starts_with|str_ends_with)\s*\('
    - '\bpreg_(?:match|match_all|replace|replace_callback|split|quote|grep)\s*\('
sources:
  - https://www.php.net/manual/en/migration82.incompatible.php
  - https://www.php.net/manual/en/function.str-contains.php
  - https://www.php.net/manual/en/function.preg-match.php
  - https://www.php.net/manual/en/migration84.incompatible.php
---
- **Byte functions on UTF-8**: `strlen`, `substr`, `str_pad`, `$s[0]` count bytes → truncation splits characters, then `json_encode` or the DB rejects the string. Fix: `mb_*` functions.
- **ASCII-only case folding**: since 8.2 `strtolower`, `ucfirst`, `stripos`, `str_ireplace` ignore non-ASCII letters → case-insensitive dedup misses `É`/`é`. Fix: `mb_strtolower()`.
- **Empty needle**: `str_contains($h, '')` and `str_starts_with($h, '')` are true, `strpos($h, '')` is 0 → checks on user fragments pass for empty input. Fix: reject `''` first.
- **PCRE failure values**: on backtrack/JIT limits or bad UTF-8, `preg_match` returns `false` and `preg_replace` returns `null` → read as "no match" or the text is wiped. Fix: check, log `preg_last_error_msg()`.
- **`$` and newlines**: `/^\d+$/` also accepts `"123\n"` → validated values carry a newline into headers or logs. Fix: `\z` or the `D` modifier.
- **Missing `u`**: `.`, `\w` and `[а-я]` then match bytes and split characters. Fix: add `u`, handle `false` for invalid input.
- **preg_quote delimiter**: `preg_quote($input)` without the delimiter leaves `/` unescaped → broken or attacker-shaped patterns. Fix: `preg_quote($s, '/')`.
- **PCRE2 in 8.4**: `{,3}` became a quantifier → patterns with a literal `{,n}` change meaning.
