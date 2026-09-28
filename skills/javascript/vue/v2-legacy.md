---
tier: full
name: Vue 2 idioms and migration
description: Vue 2 reactivity caveats in Vue 2.x code, and Vue 2 APIs that are ignored or removed in Vue 3 (destroy hooks, event bus, $listeners, v-model contract, $attrs class/style).
priority: 58
activation:
  content:
    - "\\bVue\\.(?:set|delete|extend|observable|filter|component|mixin)\\b"
    - "\\bthis\\.\\$(?:set|delete|on|off|once|listeners|children)\\b"
    - "\\b(?:beforeDestroy|destroyed)\\s*[(:]"
    - "\\bnew Vue\\s*\\("
    - "\\.(?:sync|native)\\b"
    - "^\\s*filters\\s*:\\s*\\{"
  examples:
    - 'Vue.set(this.items, index, value);'
    - 'this.$set(this.obj, ''key'', value);'
    - 'beforeDestroy() { clearInterval(this.timer); },'
    - 'new Vue({ el: ''#app'', data: { count: 0 } });'
    - '<child-component :value.sync="value" @click.native="onClick" />'
    - '  filters: {'
sources:
  - https://v2.vuejs.org/v2/guide/reactivity.html
  - https://v3-migration.vuejs.org/breaking-changes/
  - https://v3-migration.vuejs.org/breaking-changes/v-model.html
  - https://v3-migration.vuejs.org/breaking-changes/events-api.html
---
- **Vue 2 – new properties**: `this.obj.newKey = v` on an object lacking that key, or `delete this.obj.k` → not reactive in Vue 2. Fix: `this.$set`/`Vue.set`, or replace the object.
- **Vue 2 – array index/length**: `this.items[i] = v` or `this.items.length = 0` → no update in Vue 2. Fix: `splice`, or `this.$set(this.items, i, v)`.
- **Vue 3 – renamed hooks**: `beforeDestroy`/`destroyed` options are ignored in Vue 3 without the compat build → cleanup never runs, leaks. Fix: `beforeUnmount`/`unmounted`.
- **Vue 3 – removed APIs**: `$on/$off/$once` event buses, `$listeners`, `$children`, `.native`, filters, `Vue.set` → TypeErrors or silently dropped listeners. Fix: mitt or `emits`, `$attrs`, template refs, computed/methods.
- **Vue 3 – v-model contract**: custom components still using a `value` prop + `input` event, or `.sync` → the binding silently does nothing. Fix: `modelValue` + `update:modelValue`, or `v-model:arg`.
- **Vue 3 – $attrs**: `$attrs` now includes `class`, `style` and listeners → with `inheritAttrs: false` + `v-bind="$attrs"` on an inner element they move there too (styling, doubled handlers). Fix: bind `$attrs` deliberately.
