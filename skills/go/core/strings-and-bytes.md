---
name: Strings, bytes and runes
description: Trim cutset confusion, byte-versus-rune indexing, strings.Split edge cases, views returned by bytes.Buffer/bufio that are overwritten, unsafe string/byte conversions and regexps compiled per call.
priority: 55
tags: [CWE-682]
activation:
  content:
    - '\bstrings\.(?:Trim(?:Left|Right)?|Split\w{0,5}|Fields\w{0,4}|Title|Index\w{0,4})\s*\('
    - '\bbytes\.(?:Buffer|Trim\w{0,5}|Split\w{0,5})\b'
    - '\.(?:Bytes|ReadSlice)\(\)'
    - '\butf8\.|\[\]rune\('
    - '\bunsafe\.(?:String|StringData|Slice|SliceData)\b'
    - '\bregexp\.(?:MustCompile|Compile)\w{0,5}\('
sources:
  - https://pkg.go.dev/strings#TrimLeft
  - https://go.dev/blog/strings
  - https://pkg.go.dev/bytes#Buffer.Bytes
  - https://pkg.go.dev/unsafe#String
---
- **Cutsets, not prefixes**: `strings.TrimLeft(s, "https://")`, `TrimRight(name, ".json")` or `Trim` remove any run of those characters (`TrimLeft("stats", "st")` → `"ats"`) → corrupted ids, hosts and paths. Fix: `TrimPrefix`/`TrimSuffix` or `strings.CutPrefix`.
- **Bytes vs runes**: `len(s)`, `s[i]` and `s[:n]` count bytes — truncating names/messages to N "characters" splits UTF-8 sequences (invalid text, rejected JSON/DB writes). Fix: `utf8.RuneCountInString`, cut on rune boundaries.
- **Split on empty input**: `strings.Split("", ",")` returns `[""]` (length 1) → phantom empty element becomes an empty id, role or tag. Fix: check for empty input or drop empty parts.
- **Overwritten views**: `bytes.Buffer.Bytes()`, `bufio.Scanner.Bytes()` and `bufio.Reader.ReadSlice` return slices valid only until the next read/write/Reset → stored values change later (worse with pooled buffers). Fix: `bytes.Clone`, `Scanner.Text()`.
- **unsafe conversions**: `unsafe.String`/`unsafe.Slice(unsafe.StringData(s), …)` followed by mutating or reusing the bytes changes an "immutable" string (map keys, cached values). Fix: ordinary `string(b)`/`[]byte(s)` conversions.
- **Regexps per call**: `regexp.MustCompile` inside handlers or loops recompiles every call (CPU-heavy) and panics on user-supplied patterns. Fix: package-level regexps; `regexp.Compile` + error for user input (RE2 is linear: no ReDoS).
