---
name: Strings, UTF-16 and text parsing
description: Swift String pitfalls — NSRange/UTF-16 offsets built from Character counts, indices reused across strings, split() dropping empty fields, invalid UTF-8, O(n) counting in loops and Unicode normalization mismatches.
activation:
  content:
    - '\bNS(?:Range|String|MutableAttributedString|AttributedString|RegularExpression)\b|\.utf(?:8|16)\b|\bString\.Index\b'
    - '\.(?:split|components|index|distance|replacingOccurrences|precomposedStringWithCanonicalMapping)\('
    - '\bString\((?:data|decoding|bytes|cString):'
sources:
  - https://developer.apple.com/documentation/swift/string
  - https://developer.apple.com/documentation/swift/string/utf16view
  - https://developer.apple.com/documentation/swift/sequence/split(separator:maxsplits:omittingemptysubsequences:)
---
- **NSRange from Character counts**: `NSRange(location: 0, length: text.count)` or Character offsets passed to `NSAttributedString`, `NSRegularExpression` or text-view delegates → wrong ranges or crashes with emoji and combining marks (NSString counts UTF-16). Fix: `NSRange(range, in: text)`, `Range(nsRange, in: text)`.
- **Foreign String.Index**: an index computed on one string (or before a mutation) used on another → trap or wrong character. Fix: recompute indices on the string being subscripted.
- **split drops empty fields**: `split(separator:)` omits empty subsequences by default → CSV, `key=value` and path parsing shift columns when a field is empty. Fix: `omittingEmptySubsequences: false` or `components(separatedBy:)`.
- **Invalid UTF-8**: `String(data: d, encoding: .utf8)!` crashes on bad bytes; `String(decoding:as:)` silently inserts U+FFFD → corrupted tokens, signatures or binary data. Fix: handle `nil`; keep binary as `Data`.
- **O(n) counting**: `count` and `index(_:offsetBy:)` walk the string → `s[s.index(s.startIndex, offsetBy: i)]` or `s.count` inside loops is O(n²). Fix: iterate once or convert to `Array(s)`.
- **Normalization**: Swift `==` treats canonically equivalent strings as equal, but `utf8`/`Data` bytes, HMACs and servers compare code units → composed vs decomposed "é" (e.g. macOS file names) mismatch. Fix: `precomposedStringWithCanonicalMapping` before hashing or sending.
