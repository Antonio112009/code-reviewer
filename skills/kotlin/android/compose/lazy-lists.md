---
name: Lazy lists and grids
description: LazyColumn/LazyRow/LazyGrid defects — missing or unstable item keys that move remembered state to the wrong row, duplicate or non-Bundle keys, nested same-direction scrolling, many rows in one item and zero-size items.
priority: 62
tags: [CWE-665]
activation:
  content:
    - '\bLazy(?:Column|Row|VerticalGrid|HorizontalGrid|VerticalStaggeredGrid|HorizontalStaggeredGrid)\s*[({]'
    - '\bitems(?:Indexed)?\s*\('
    - '\bkey\s*=\s*\{'
    - '\b(?:verticalScroll|horizontalScroll)\s*\('
sources:
  - https://developer.android.com/develop/ui/compose/lists
  - https://developer.android.com/develop/ui/compose/performance/bestpractices#use-lazy-layout-keys
---
- **Missing keys**: `items(list) { … }` without `key` ties remembered state (`remember`, `rememberSaveable`, animations, text input) to the position → after insert, delete or reorder, rows show another item's expanded/checked state. Fix: `key = { it.id }`.
- **Index or duplicate keys**: `itemsIndexed(…, key = { i, _ -> i })` behaves like no key; duplicate keys throw `IllegalArgumentException` at runtime. Fix: unique stable IDs.
- **Non-Bundle keys**: keys of custom class types can't be stored in a `Bundle` → crash when the state is saved. Fix: primitives, `String`, enums or `Parcelable` IDs.
- **Nested same-direction scrolling**: a `LazyColumn` inside `Column(Modifier.verticalScroll(…))` (or `LazyRow` in `horizontalScroll`) without a bounded size → `IllegalStateException`. Fix: one `LazyColumn` with `item {}` sections.
- **Many rows in one item**: `item { list.forEach { Row(it) } }` composes everything at once and breaks `scrollToItem` indexes → no laziness, jank on large lists. Fix: `items(list)`.
- **Zero-size items**: rows whose images load asynchronously with no placeholder size start at 0 px → the lazy layout composes every item at once. Fix: fixed or minimum sizes; `contentType` for mixed row types.
