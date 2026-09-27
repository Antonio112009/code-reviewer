---
name: Nil values, interfaces and type assertions
description: Typed nil stored in interfaces, writes to nil maps, unchecked type assertions and runtime panics from comparing uncomparable dynamic types.
priority: 60
tags: [CWE-476, CWE-754]
activation:
  content:
    - '\bnil\b'
    - '\.\(\s*(?:\*?[A-Za-z_][\w.]{0,60}|\[\]|map\[)\s*\)'
    - '\bcomparable\b'
    - '\bmap\[(?:any|interface\{\})\]'
sources:
  - https://go.dev/doc/faq#nil_error
  - https://go.dev/ref/spec#Comparison_operators
  - https://go.dev/blog/comparable
---
- **Typed nil in an interface**: returning a nil `*MyError` (or any nil pointer) as `error`/interface makes `err != nil` true → success handled as failure. Fix: return a literal `nil`.
- **Nil map writes**: assigning into a map never `make`d — zero-value struct fields, `var m map[K]V`, maps decoded from JSON `null` — panics at runtime. Fix: initialise in the constructor or before writing.
- **Unchecked assertions**: `v := x.(T)` on values from `map[string]any`, JSON, context or plugins panics when the type differs or `x` is nil (JSON numbers are `float64`, not `int`). Fix: `v, ok := x.(T)`.
- **Uncomparable at runtime**: `==` on interfaces holding slices, maps or funcs, `map[any]V` keys, or generic `comparable` code instantiated with an interface type (Go 1.20+) → panic "comparing uncomparable type". Fix: tighter constraints, type switch.
- **Unset dependencies**: methods called through a nil embedded pointer, nil func fields (callbacks/options never set) or nil interface fields panic far from the omission. Fix: validate required fields in the constructor.
