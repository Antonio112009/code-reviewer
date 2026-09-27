---
name: Array pitfalls
description: Lexicographic and in-place sorting, mutating methods on shared arrays, -1 indexes from indexOf/findIndex, reduce without a seed, shared fill references and mutation while iterating.
priority: 55
activation:
  content:
    - '\.(?:sort|splice|reverse|fill|copyWithin|reduce|reduceRight|indexOf|lastIndexOf|findIndex|findLastIndex|includes|shift|unshift)\s*\('
    - '\bnew\s+Array\s*\(|\bArray\s*\(\s*\w'
    - '\bdelete\s+[\w$.]+\['
    - '\.length\s*=[^=]'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/toSorted
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/splice
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce
---
- **Default sort order**: `nums.sort()` compares as strings (`[1, 10, 2]`); comparators returning booleans (`(a, b) => a > b`) are inconsistent → engine-dependent order. Fix: `(a, b) => a - b`; `Intl.Collator`/`localeCompare` for text.
- **In-place mutation**: `sort`, `reverse`, `splice`, `fill` mutate and `sort`/`reverse` return the same reference → props, cached or state arrays change (TypeError if frozen, no re-render). Fix: `toSorted`/`toReversed`/`toSpliced` (ES2023, Node ≥20) or copy first.
- **-1 used as an index**: `list.splice(list.indexOf(x), 1)` deletes the LAST element when `x` is missing; `arr[arr.findIndex(…)]` yields `undefined`. Fix: check `idx !== -1`.
- **`reduce` without a seed**: throws `TypeError` on an empty array and uses the first element as the accumulator (wrong type when summing objects). Fix: always pass the initial value.
- **Shared fill values**: `Array(n).fill({})`/`fill([])` puts one object in every slot → updating one row updates all; `new Array(n).map(fn)` returns holes. Fix: `Array.from({ length: n }, () => ({}))`.
- **Mutation while iterating**: `splice`/`shift` inside a forward loop or `forEach` over the same array skips the next element; items pushed during `forEach` are not visited. Fix: `filter` into a new array or iterate backwards.
