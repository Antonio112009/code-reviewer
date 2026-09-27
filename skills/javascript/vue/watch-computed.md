---
name: Watchers and computed
description: watch/watchEffect and computed() defects — watching values instead of sources, shallow array watches, untracked async dependencies, fetch races, leaked watchers and impure computed getters.
priority: 64
activation:
  content:
    - "(?<![.\\w$])(?:watch|watchEffect|watchPostEffect|watchSyncEffect|computed)\\s*(?:<[^>\\n]{0,80}>)?\\("
    - "\\$watch\\s*\\("
    - "^\\s*(?:watch|computed)\\s*:\\s*\\{"
  versions: { framework.vue: ">=3" }
sources:
  - https://vuejs.org/guide/essentials/watchers.html
  - https://vuejs.org/guide/essentials/computed.html
  - https://v3-migration.vuejs.org/breaking-changes/watch.html
---
- **Value instead of source**: `watch(obj.count, …)`, `watch(props.id, …)` or a destructured prop → watches a constant, never fires. Fix: getter `() => props.id`.
- **Shallow array watch**: `watch(listRef, …)` fires only when the array is replaced (Vue 3), not on `push`/`splice`. Fix: `{ deep: true }` (3.5+ also takes a depth number) or watch `() => list.value.length`.
- **Untracked after await**: `watchEffect(async …)` tracks only refs read before the first `await` → later dependencies never retrigger it. Fix: read them first, or `watch` explicit sources.
- **Race without cleanup**: async watcher/effect fetches without aborting → a slower old response overwrites newer data. Fix: `AbortController` aborted in `onWatcherCleanup` (3.5+, register before any `await`) or the `onCleanup` argument.
- **Leaked watcher**: `watch`/`watchEffect` created in `setTimeout`, a promise callback or after `await` outside `<script setup>` → not bound to the component; runs after unmount. Fix: create synchronously or call the stop handle.
- **DOM read in pre-flush**: callback reads template refs/DOM with the default `flush: 'pre'` → sees the old DOM. Fix: `flush: 'post'`/`watchPostEffect` or `await nextTick()`.
- **Impure computed**: getter mutates state, sorts/reverses the source array in place, fetches, or reads non-reactive values (`Date.now()`, `localStorage`) → loops, corrupted source, a never-refreshing value. Fix: copy before `sort()`; effects in watchers.
