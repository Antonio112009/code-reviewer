---
name: Effects, lifecycle and ownership
description: SolidJS effect defects — effects used to derive state, missing onCleanup, computations created without an owner, client-only lifecycle assumptions during SSR and effects tracking too much.
priority: 60
activation:
  content:
    - "\\bcreate(?:Effect|RenderEffect|Root|Reaction)\\s*[(<]"
    - "\\b(?:onMount|onCleanup|untrack|batch|getOwner|runWithOwner)\\s*\\("
    - "(?<![.\\w$])on\\s*\\(\\s*[a-zA-Z_$\\[]"
  examples:
    - "createEffect(() => { console.log(count()); });"
    - "onCleanup(() => clearInterval(id));"
    - "createEffect(on(source, (value) => { doSomething(value); }));"
  versions: { framework.solid: "<2" }
sources:
  - https://docs.solidjs.com/concepts/effects
  - https://docs.solidjs.com/reference/reactive-utilities/create-root
  - https://docs.solidjs.com/reference/lifecycle/on-cleanup
---
- **Effect as derivation**: `createEffect(() => setTotal(a() + b()))` → an extra update pass, glitches, possible loops. Fix: `createMemo` or a derived function.
- **Missing cleanup**: listeners, intervals, sockets or observers created in effects or `onMount` without `onCleanup` → duplicates on reruns, leaks after unmount. Fix: register `onCleanup` in the same scope.
- **No owner**: effects/memos created at module scope, in `setTimeout` or after `await` → never disposed (dev warns about computations outside `createRoot`). Fix: `createRoot(dispose => …)`, or capture `getOwner()` and use `runWithOwner`.
- **SSR assumptions**: `createEffect`/`onMount` don't run on the server → state they set is missing from SSR HTML; browser APIs in the component body crash SSR. Fix: browser-only code in `onMount` or behind `isServer`.
- **Tracking too much**: effects reading whole stores (`JSON.stringify(store)`) or many signals → rerun on any change, heavy work. Fix: `on(dep, fn)` with explicit deps, or `untrack` incidental reads.
