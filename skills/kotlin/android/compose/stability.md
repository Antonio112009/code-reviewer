---
name: Compose stability and recomposition cost
description: Skipping and recomposition cost under strong skipping (default since Kotlin 2.0.20) — in-place mutation of parameters, false @Stable/@Immutable promises, fast-changing state read too high, expensive work without remember and derivedStateOf misuse.
priority: 60
tags: [CWE-1050]
activation:
  content:
    - '@(?:Stable|Immutable)\b'
    - '\bstabilityConfigurationFile\b|\benableStrongSkippingMode\b|\bcomposeCompiler\s*\{'
    - '\b(?:firstVisibleItemIndex|firstVisibleItemScrollOffset|scrollState\.value|animate\w*AsState)\b'
    - '\.(?:sortedBy|sortedWith|filter|groupBy)\s*[({]'
    - '\bderivedStateOf\s*\{'
    - '\bModifier\.(?:offset|graphicsLayer|drawBehind)\s*\('
sources:
  - https://developer.android.com/develop/ui/compose/performance/stability/strongskipping
  - https://developer.android.com/develop/ui/compose/performance/bestpractices
  - https://developer.android.com/develop/ui/compose/performance/stability/fix
  - https://kotlinlang.org/docs/whatsnew24.html#compose-compiler
---
- **Mutating parameters in place**: with strong skipping, unstable parameters are compared by instance (`===`) → passing the same mutated `MutableList` or object skips the composable → stale UI. Fix: immutable models; new instance per change.
- **False stability promises**: `@Stable`/`@Immutable` (or a stability configuration file entry) on types with `var`s or mutable collections → Compose trusts `equals`, skips updates. Fix: annotate only truly immutable or snapshot-backed types.
- **Fast state read high up**: reading scroll offsets or animated values in a parent's body (`Modifier.offset(y = …)`) recomposes the whole subtree every frame → jank. Fix: lambda modifiers `offset { }`, `graphicsLayer { }`, `drawBehind { }`.
- **Expensive work in composition**: sorting, filtering, grouping or formatting large lists in the body without `remember(input) { }` → recomputed on each recomposition, possibly per frame. Fix: `remember` with keys or do it in the ViewModel.
- **derivedStateOf misuse**: a threshold on fast state (`listState.firstVisibleItemIndex > 0`) read directly recomposes on every scroll; wrapping cheap combinations in `derivedStateOf` adds overhead. Fix: use it only when inputs change more often than the result.
