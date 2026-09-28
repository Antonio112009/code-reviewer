---
name: Slices, maps and iterators
description: Slice aliasing through append and sub-slices, copy/clear/slices.Delete semantics, random map iteration order and range-over-func iterator misuse (Go 1.23+).
priority: 58
tags: [CWE-664]
activation:
  content:
    - '\bappend\s*\('
    - '\b(?:copy|clear)\s*\('
    - '\b(?:slices|maps|iter)\.[A-Z]'
    - '\byield\s*\('
    - '\bfor\b[^\n]{0,80}\brange\b'
  examples:
    - 'items = append(items, next)'
    - 'clear(cache)'
    - 'keys := slices.Sorted(maps.Keys(m))'
    - 'if !yield(v) { return }'
    - 'for _, v := range items {'
sources:
  - https://go.dev/blog/slices-intro
  - https://go.dev/doc/go1.22
  - https://pkg.go.dev/iter
---
- **append aliasing**: `b := append(a[:i], x)`, `append(s[:i], s[i+1:]...)` or appending to a caller's slice with spare capacity overwrites the shared array → another slice changes silently. Fix: `slices.Clone` or `a[:n:n]`.
- **Pinned memory**: keeping a small sub-slice/substring of a large or pooled buffer keeps the whole array alive → memory growth. Fix: `bytes.Clone`/`strings.Clone` what you keep.
- **copy and clear**: `copy` copies `min(len(dst), len(src))` — into `make([]T, 0, n)` nothing; `clear(s)` zeroes elements but keeps `len`. Fix: `make([]T, len(src))`, `s = s[:0]`.
- **Shrinking in place (Go 1.22+)**: `slices.Delete`, `DeleteFunc`, `Compact`, `Replace` zero the vacated tail → other references to the old slice see zero values/nil pointers. Fix: use only the returned slice.
- **Map order**: `range m` is randomised → API output, "first match", pagination, hashes/signatures and expectations built from maps vary per run. Fix: `slices.Sorted(maps.Keys(m))`.
- **Iterators (Go 1.23+)**: calling `yield` after it returned false panics; `iter.Pull` without `defer stop()` leaks; single-use sequences (rows, scanners) ranged twice yield nothing. Fix: `if !yield(v) { return }`.
