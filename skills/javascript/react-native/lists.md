---
name: Lists and virtualization
description: FlatList / SectionList / FlashList defects — stale rows without extraData, unstable keys, row state lost or leaked by windowing and recycling, nested virtualized lists, unbounded ScrollView maps and duplicate onEndReached loads.
priority: 62
tags: [CWE-400]
activation:
  content:
    - '\b(?:FlatList|SectionList|VirtualizedList|FlashList|LegendList)\b'
    - '\brenderItem\b'
    - '<ScrollView\b'
  examples:
    - '<FlatList data={items} renderItem={renderRow} keyExtractor={item => item.id} />'
    - '<ScrollView>{items.map(renderRow)}</ScrollView>'
sources:
  - https://reactnative.dev/docs/flatlist
  - https://reactnative.dev/docs/optimizing-flatlist-configuration
  - https://shopify.github.io/flash-list/docs/recycling
  - https://reactnative.dev/docs/scrollview
---
- **Stale rows**: `renderItem` reads state outside `data` (selection, filters, theme) that is not passed as `extraData` → rows never re-render (the list is a PureComponent). Fix: pass it as `extraData`, a new reference on change.
- **Implicit index keys**: no `keyExtractor` and items without `key`/`id` → FlatList silently falls back to the index → wrong row state after inserts, deletes or prepends (chat, feeds). Fix: `keyExtractor` returning a stable id.
- **Row-local state**: `useState` in row components (expanded, draft text) → lost when the row leaves the render window (FlatList) or leaked into another item when a FlashList cell is recycled. Fix: lift state keyed by id; FlashList `useRecyclingState`.
- **Nested virtualization**: a FlatList inside a same-direction `ScrollView` → windowing disabled, all rows rendered, "VirtualizedLists should never be nested" error. Fix: one list with `ListHeaderComponent`/`ListFooterComponent`.
- **Unbounded ScrollView**: `<ScrollView>{items.map(…)}</ScrollView>` over server or user data → every row mounted at once: memory spikes, slow first render. Fix: FlatList/FlashList.
- **Duplicate page loads**: `onEndReached` fetching without an in-flight/has-more guard → fires repeatedly (short content, re-renders) → duplicate pages, request storms. Fix: loading ref plus cursor.
- **Wrong `getItemLayout`**: constant heights ignoring separators, headers or variable rows → `scrollToIndex` lands wrong, blank gaps. Fix: add separator length or drop it.
