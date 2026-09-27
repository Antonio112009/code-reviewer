---
name: Strings, text and parsing
description: UTF-8 bytes vs characters, lenient float parsing, Unicode-aware predicates and regex classes, case-folding identities, lossy decoding, Latin-1 casts, regex compilation costs and Debug formatting misused as escaping.
priority: 55
tags: [CWE-20, CWE-178, CWE-1289, CWE-116]
activation:
  content:
    - '\.(?:chars|char_indices|to_lowercase|to_uppercase|is_alphanumeric|is_alphabetic|is_numeric)\('
    - '\bfrom_utf8(?:_lossy)?\b|\bto_string_lossy\b|\bto_str\(\)'
    - 'parse::<\s*f(?:32|64)\s*>|:\s*f(?:32|64)\s*=[^;\n]{0,80}\.parse\('
    - '\bas\s+char\b'
    - '\bRegex(?:Builder)?::new\(|\bfancy_regex::'
sources:
  - https://doc.rust-lang.org/std/primitive.f64.html#impl-FromStr-for-f64
  - https://doc.rust-lang.org/std/primitive.char.html#method.is_alphanumeric
  - https://docs.rs/regex/latest/regex/#untrusted-input
---
- [full] **Bytes vs characters**: `s.len()` counts UTF-8 bytes → "max 64 characters" limits, truncation and padding are wrong for non-ASCII text. Fix: define the unit; `chars().count()` or grapheme crates.
- **Lenient float parsing**: `"NaN"`, `"inf"`, `"1e309"` parse as `f64`; NaN fails every comparison, so `if amount < 0.0 { reject }` lets it through. Fix: `is_finite()` plus range checks; integer cents for money.
- **Unicode predicates**: `is_alphanumeric`/`is_numeric` and regex `\d`/`\w` accept non-ASCII digits and letters (`'٣'`) → "digits-only" IDs fail `parse` later or allow look-alikes. Fix: `is_ascii_*`, `[0-9]`.
- **Case-folded identities**: comparing usernames via `to_lowercase()` merges distinct strings (Kelvin sign `K` → `k`) → impersonation or duplicate accounts. Fix: normalize at write time, or ASCII-only with `eq_ignore_ascii_case`.
- **Lossy decoding**: `from_utf8_lossy`/`to_string_lossy` on data later stored or used as a path, and `b as char` (Latin-1: `é` → `Ã©`) → corrupted text, wrong file or key. Fix: `str::from_utf8`, keep `Vec<u8>`/`PathBuf`.
- **Regex cost**: `Regex::new` in handlers or loops recompiles on every call; untrusted patterns need `RegexBuilder::size_limit`; `fancy_regex` backtracks (ReDoS). Fix: `LazyLock<Regex>`.
