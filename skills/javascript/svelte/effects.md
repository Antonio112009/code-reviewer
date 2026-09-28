---
name: $effect, $derived and lifecycle
description: Svelte 5 effect and derived-state defects — effects that sync state, read-write loops, dependencies read after await, missing teardown, async onMount cleanup, SSR assumptions and side effects in $derived.
priority: 64
activation:
  content:
    - "\\$effect(?:\\.pre|\\.root)?\\s*\\("
    - "\\$derived(?:\\.by)?\\s*(?:<[^>\\n]{0,80}>)?\\("
    - "\\b(?:onMount|onDestroy|untrack|tick)\\s*\\("
  examples:
    - '$effect(() => { console.log(count); });'
    - 'let total = $derived(a + b);'
    - 'onMount(() => { const id = setInterval(poll, 1000); return () => clearInterval(id); });'
sources:
  - https://svelte.dev/docs/svelte/$effect
  - https://svelte.dev/docs/svelte/$derived
  - https://svelte.dev/docs/svelte/lifecycle-hooks
  - https://svelte.dev/docs/svelte/runtime-errors
---
- **Effect as derivation**: `$effect(() => { total = a + b })` → an extra update pass, glitches and loops. Fix: `let total = $derived(a + b)`.
- **Read-write loop**: an effect that reads and writes the same state (`count++`, `list.push()`) → `effect_update_depth_exceeded`. Fix: `untrack()` the read, or restructure as `$derived`.
- **Deps after await**: state read after `await`, or inside `setTimeout`/`.then()` in an effect → never retriggers it. Fix: read values synchronously at the top.
- **Missing teardown**: listeners, intervals, observers or subscriptions created in `$effect` without returning a cleanup → duplicates on every rerun, leaks after destroy. Fix: return a teardown function.
- **Async onMount cleanup**: `onMount(async () => { …; return () => stop() })` returns a promise → teardown never runs. Fix: synchronous `onMount` that starts async work, or `$effect` returning the teardown.
- **SSR assumptions**: `$effect`/`onMount` never run during SSR → state they initialize is missing from server HTML (flash, layout shift). Fix: compute initial values in the script or with `$derived`.
- **Impure $derived**: state writes inside `$derived` or template expressions → `state_unsafe_mutation`; a reassigned `$derived` (5.25+) is replaced when its dependencies change. Fix: pure derivations; keep user edits in `$state`.
