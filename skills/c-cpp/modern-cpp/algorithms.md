---
name: Algorithms and comparators
description: <algorithm>/<numeric> misuse — invalid ordering predicates, remove without erase, accumulate init types, unsized output ranges, sorted-range preconditions, copied stateful predicates and parallel execution policies.
priority: 55
tags: [CWE-758, CWE-787, CWE-362]
activation:
  content:
    - '\bstd::(?:ranges::)?(?:sort|stable_sort|partial_sort|nth_element|remove|remove_if|unique|accumulate|reduce|copy|copy_if|copy_n|transform|fill_n|lower_bound|upper_bound|binary_search|equal_range|merge|set_\w+|includes|max_element|min_element|for_each)\s*\('
    - '\bstd::execution::(?:par|par_unseq|unseq)\b'
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/containers-ctr/ctr57-cpp/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/containers-ctr/ctr52-cpp/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/containers-ctr/ctr58-cpp/
  - https://en.cppreference.com/w/cpp/algorithm/execution_policy_tag_t
---
- **Invalid comparators**: `<=`, inconsistent multi-field logic or NaN float keys in `sort`, `set`, `map`, `priority_queue` → no strict weak ordering → UB such as out-of-bounds reads in `std::sort` (CTR57-CPP). Fix: strict `<`; `std::tie` or `<=>`.
- **remove without erase**: `std::remove`/`remove_if`/`unique` only shift kept elements forward; the tail keeps stale values and `size()` is unchanged. Fix: erase-remove, or C++20 `std::erase_if`.
- **accumulate init type**: `std::accumulate(b, e, 0)` sums in `int` → doubles truncated, 64-bit totals overflow. Fix: `0.0`, `0LL` or `T{}`.
- **Unsized outputs**: `std::copy`/`transform`/`copy_if` into an empty or shorter container (`reserve` is not enough) → writes past the end (CTR52-CPP). Fix: `std::back_inserter`, or `resize` first.
- **Sorted-range preconditions**: `binary_search`, `lower_bound`, `equal_range`, `set_*`, `merge` on unsorted data or with a comparator other than the sort's → wrong results. Fix: sort with the same comparator.
- **Stateful predicates**: algorithms may copy predicates, so counters in functors or `mutable` lambdas act on copies (CTR58-CPP). Fix: stateless predicates.
- **Parallel policies**: `std::execution::par` lambdas touching shared state race; exceptions escaping element functions call `std::terminate`; locks are forbidden under `par_unseq`. Fix: independent elements; `reduce` over shared counters.
