---
name: Quadratic loops and hot-path waste
description: CPython hot-path costs — list membership in loops, list used as a queue, repeated string/bytes concatenation, DataFrame/array accumulation in loops, row-wise pandas, invariant work inside loops and materializing lists only to consume them.
priority: 48
activation:
  content:
    - "\\bif\\s+[^\\n:]{1,80}\\s(?:not\\s+)?in\\s+\\w*(?:list|ids|items|rows|values|names|keys)\\w*\\s*:|\\.index\\s*\\(|\\.count\\s*\\("
    - "\\.(?:pop|insert)\\s*\\(\\s*0\\b"
    - "\\w\\s*\\+=\\s*(?:f?[\"']|str\\s*\\(|\\w+\\s*\\+\\s*[\"'])"
    - "\\b(?:pd\\.concat|np\\.(?:append|concatenate|vstack|hstack))\\s*\\(|\\._?append\\s*\\(\\s*(?:df|pd\\.|row)"
    - "\\.(?:iterrows|itertuples)\\s*\\(|\\.apply\\s*\\([^)\\n]{0,120}\\baxis\\s*=\\s*1\\b"
    - "\\b(?:sum|any|all|max|min|sorted|set)\\s*\\(\\s*\\[[^\\]\\n]{1,120}\\bfor\\b|\\bcopy\\.deepcopy\\s*\\("
sources:
  - https://docs.python.org/3/library/stdtypes.html#common-sequence-operations
  - https://docs.python.org/3/library/collections.html#collections.deque
  - https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.iterrows.html
  - https://pandas.pydata.org/docs/user_guide/enhancingperf.html
---
- **Membership in lists**: `x in some_list`, `list.index()` or `list.count()` inside a loop over another collection is O(n·m) → minutes at 10⁵ items. Fix: build a `set`/`dict` once, outside the loop.
- **List as a queue**: `pop(0)` and `insert(0, x)` shift every element → quadratic queues and sliding windows. Fix: `collections.deque`.
- **Repeated concatenation**: `s += piece`, `bytes +=` or `acc = acc + [x]` in loops rebuild the object each time → quadratic time (CPython's in-place str shortcut isn't guaranteed). Fix: collect parts, then `"".join()`, `io.StringIO` or `bytearray`.
- **Accumulating frames and arrays**: `pd.concat`, `np.append` or `np.vstack` inside a loop copies all previous data each iteration → quadratic time and memory. Fix: collect pieces in a list; concatenate once.
- **Row-wise pandas**: `iterrows()` (which also loses dtypes), `apply(axis=1)` and loops over `.loc[i]` are orders of magnitude slower than column operations. Fix: vectorized expressions, `np.where`, `merge`.
- **Invariant work in loops**: sorting, `copy.deepcopy`, compiling dynamic regexes or re-reading files/config on every iteration. Fix: hoist it out of the loop.
- **Materializing to consume**: `sum([...])`, `any([...])` or `sorted(...)[0]` build full lists, and `any` loses short-circuiting. Fix: generator expressions, `min()`.
