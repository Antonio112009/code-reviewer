---
name: Control flow and @defer
description: Angular template defects — @for track expressions that recreate or misplace rows, expensive calls in bindings, and @defer blocks that load eagerly, never trigger or hide content from SSR.
priority: 58
activation:
  content:
    - "@for\\s*\\("
    - "@defer\\b"
    - "\\*ngFor\\b"
    - "\\btrackBy\\s*:"
    - "\\bwithIncrementalHydration\\s*\\("
  versions: { framework.angular: ">=17" }
sources:
  - https://angular.dev/guide/templates/control-flow
  - https://angular.dev/guide/templates/defer
  - https://angular.dev/guide/incremental-hydration
---
- **track by identity**: `track item` over data re-fetched from an API (new objects each time) → every row's DOM and child state recreated (lost focus, inputs, animations). Fix: `track item.id`.
- **track $index on dynamic lists**: `track $index` for rows that are inserted, removed or reordered and hold state → state stays at the old position. Fix: stable ids.
- **Deferred dependency loaded eagerly**: a component inside `@defer` that is non-standalone or also referenced outside the block in the same file (other template usage, `viewChild`) → bundled eagerly, no lazy chunk. Fix: reference it only inside the block.
- **Trigger never fires**: `on viewport`/`on interaction`/`on hover` relying on a `@placeholder` without exactly one root element → nothing to observe. Fix: single-root placeholder or an explicit template reference.
- **SSR renders placeholders**: without a `hydrate` trigger, SSR renders only `@placeholder` (triggers never run on the server) → content missing from HTML/SEO, layout shift. Fix: `hydrate on …` (incremental hydration: default since v22, `withIncrementalHydration()` in v19–21).
- **Expensive bindings**: method calls or getters doing work (filtering, formatting, `new Date()`) in templates run on every check → jank, and NG0100 for non-deterministic values. Fix: `computed` or pure pipes.
