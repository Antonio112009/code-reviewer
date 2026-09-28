---
name: v-for lists and keys
description: v-for defects — missing or index keys on stateful rows, v-if/v-for precedence, duplicate keys, in-place sorting in templates, ref ordering and 1-based ranges.
priority: 58
activation:
  content: ["\\bv-for\\s*="]
  examples: ['<li v-for="item in items" :key="item.id">{{ item.name }}</li>']
sources:
  - https://vuejs.org/guide/essentials/list.html
  - https://vuejs.org/guide/essentials/template-refs.html
  - https://v3-migration.vuejs.org/breaking-changes/v-if-v-for.html
---
- **Unstable key**: no `:key`, or `:key="index"`, on rows holding inputs, child-component state or transitions in lists that insert/remove/reorder → state and focus attach to the wrong item. Fix: stable unique id.
- **v-if with v-for**: both on one element — in Vue 3 `v-if` is evaluated first, so `v-if="item.visible"` cannot see `item` (unlike Vue 2). Fix: filter in a `computed`, or move `v-for` to a wrapping `<template>`.
- **Duplicate keys**: keys built from non-unique fields (name, date, title) → rows patched incorrectly. Fix: unique ids.
- **In-place sort**: `v-for="x in items.sort()"`/`.reverse()` in templates or computed mutates the source array → render loops, reordered state. Fix: `[...items].sort()` or `toSorted()`.
- **Ref order**: template refs collected inside `v-for` do not follow source order → `refs[i]` hits the wrong element. Fix: function refs keyed by item id.
- **1-based ranges**: `v-for="n in 10"` starts at 1 → off-by-one when indexing arrays. Fix: use `n - 1`.
