---
name: Props, emits and v-model
description: Component contract bugs — mutated props, non-reactive destructured props, shared default objects, undeclared emits firing twice, defineModel desync and Boolean casting order.
priority: 64
activation:
  content:
    - "\\bdefine(?:Props|Emits|Model)\\s*[(<]"
    - "\\bwithDefaults\\s*\\("
    - "\\$emit\\s*\\("
    - "^\\s*(?:props|emits)\\s*:\\s*[\\[{]"
    - "\\bmodelValue\\b"
  examples:
    - 'const props = defineProps<{ id: number }>();'
    - 'const props = withDefaults(defineProps<Props>(), { size: ''md'' });'
    - 'this.$emit(''save'', payload);'
    - '  props: [''modelValue''],'
  versions: { framework.vue: ">=3" }
sources:
  - https://vuejs.org/guide/components/props.html
  - https://vuejs.org/guide/components/v-model.html
  - https://v3-migration.vuejs.org/breaking-changes/emits-option.html
  - https://vuejs.org/guide/typescript/composition-api.html
---
- **Nested prop mutation**: `props.items.push()`, `props.form.name = …` or `v-model="props.user.email"` → silently edits the parent's (or a store's) object. Fix: emit an update or edit a local copy.
- **Destructured props**: `const { id } = defineProps()` is a frozen value in Vue ≤3.4; in 3.5+ it is reactive, but `watch(id, …)`/`useX(id)` still pass a constant. Fix: `props.id` or `() => id`.
- **Initial-only copy**: `const local = ref(props.value)` never follows later prop changes → stale form state. Fix: `computed`, or `watch` the prop to resync.
- **Shared mutable default**: `withDefaults`/`default:` giving a literal `[]`/`{}` instead of a factory → one object shared by all instances. Fix: `() => []` (3.5+ destructure defaults are safe).
- **Undeclared emit**: emitting `click` (or another native event name) without listing it in `emits` → the parent listener also falls through to the root element and fires twice. Fix: declare every emitted event.
- **defineModel desync**: `defineModel({ default: x })` while the parent binds `undefined` → child shows `x`, parent keeps `undefined`; nested edits of a model object mutate the parent without emitting `update:modelValue`. Fix: initialize in the parent; assign new objects.
- **Boolean casting order**: `type: [String, Boolean]` turns `<Comp disabled />` into `''`, not `true`. Fix: list `Boolean` first.
