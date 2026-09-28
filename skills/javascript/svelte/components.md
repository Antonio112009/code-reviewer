---
name: Props, bindings, events and each blocks
description: Svelte 5 component defects — mutated non-bindable props, non-reactive fallback objects, event modifiers lost in migration, unkeyed or duplicate-keyed each blocks and unstable SSR ids.
priority: 60
activation:
  content:
    - "\\$(?:props|bindable)(?:\\.id)?\\s*\\("
    - "\\{#each\\b"
    - "\\bbind:[a-zA-Z]+"
    - "\\bon[a-z]+=\\{"
  examples:
    - 'let { value = $bindable() } = $props();'
    - '{#each items as item (item.id)}'
    - '<input bind:value={name} />'
    - '<button onclick={() => save()}>Save</button>'
sources:
  - https://svelte.dev/docs/svelte/$props
  - https://svelte.dev/docs/svelte/each
  - https://svelte.dev/docs/svelte/v5-migration-guide
  - https://svelte.dev/docs/svelte/runtime-errors
---
- **Mutating props**: a child writing `item.done = true` or pushing to a prop array that is not `$bindable` → `ownership_invalid_mutation`, parent state changed behind its back; plain-object props don't update at all. Fix: callback props, or `$bindable()` with `bind:`.
- **Fallback objects**: `let { options = { … } } = $props()` → the fallback is not a reactive proxy; mutating it never updates the UI. Fix: treat as read-only or copy into `$state`.
- **Lost modifiers**: migrating `on:submit|preventDefault` to `onsubmit={handler}` → modifiers don't exist on event attributes; the form reloads the page. Fix: call `event.preventDefault()` in the handler.
- **Unkeyed each**: `{#each items as item}` without `(item.id)` for rows with inputs, child state or transitions → removing an item deletes the last DOM node and shifts state onto the wrong rows. Fix: key by a unique string/number id.
- **Duplicate keys**: keys from non-unique fields → `each_key_duplicate` runtime error. Fix: unique ids.
- **Unstable ids**: element ids from counters or `Math.random()` for labels/ARIA in SSR → hydration mismatch, broken label links. Fix: `$props.id()` (5.20+).
