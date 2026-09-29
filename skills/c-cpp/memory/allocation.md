---
name: Heap allocation sizes and realloc
description: malloc/calloc/realloc size arithmetic that wraps, wrong element sizes, realloc leaks and stale pointers, realloc(p, 0), unchecked allocation results and lost alignment.
priority: 70
tags: [CWE-190, CWE-131, CWE-401, CWE-690]
activation:
  content:
    - '\b(?:malloc|calloc|realloc|reallocarray|aligned_alloc|posix_memalign|strn?dup)\s*\('
  examples:
    - 'int *p = malloc(n * sizeof *p);'
checks:
  - id: realloc-overwrites-pointer
    language: [C, Cpp]
    message: realloc result assigned to the same pointer — when realloc fails it returns NULL and the original block leaks (and the pointer is lost)
    severity: major
    category: resource-leak
    confidence: 0.7
    rule:
      any:
        - pattern: $P = realloc($P, $$$)
        - pattern: $P = ($T)realloc($P, $$$)
    examples:
      - "void grow(char **buf, size_t n) {\n  *buf = realloc(*buf, n);\n}"
      - "void grow(struct vec *v) {\n  v->items = realloc(v->items, v->cap * 2);\n}"
      - "void grow(char **buf, size_t n) {\n  *buf = (char *)realloc(*buf, n);\n}"
    counterexamples:
      - "int grow(char **buf, size_t n) {\n  char *tmp = realloc(*buf, n);\n  if (!tmp) return -1;\n  *buf = tmp;\n  return 0;\n}"
sources:
  - https://man7.org/linux/man-pages/man3/malloc.3.html
  - https://en.cppreference.com/w/c/memory/realloc
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/memory-management-mem/mem35-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/memory-management-mem/mem36-c/
---
- **Wrapping size math**: `malloc(n * size)`, `malloc(len + 1)`, `realloc(p, count * sizeof *p)` with external or 32-bit operands → wraps to a small block that is then overflowed. Fix: `calloc`, `reallocarray` (glibc ≥ 2.26), C23 `ckd_mul`.
- **Wrong element size**: `malloc(sizeof(T *))` for a `T`, `malloc(n)` for `n` ints, `sizeof(struct)` ignoring a flexible array member → block too small. Fix: `p = malloc(n * sizeof *p)`.
- **realloc leak**: `p = realloc(p, n)` overwrites the only pointer with NULL on failure while the old block stays allocated. Fix: assign to a temporary first.
- **Stale pointers after realloc**: pointers or iterators into the old block used after a `realloc` that moved it → use-after-free. Fix: recompute from the new base after every resize.
- **realloc(p, 0)**: implementation-defined in C17 (may free and return NULL, so a later `free(p)` double-frees), undefined in C23. Fix: call `free` for size 0.
- **Unchecked results**: `malloc`/`calloc`/`strdup` used without a NULL check → NULL-offset writes, which can hit mapped memory for large offsets. Fix: check every allocation.
- **Alignment**: `realloc` of `aligned_alloc`/`posix_memalign` blocks drops the alignment (MEM36-C); `aligned_alloc` returns NULL when the size is not a multiple of the alignment. Fix: allocate aligned anew and copy.
