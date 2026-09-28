---
name: Compose side effects
description: Effects in Compose — work and state writes in the composition body, backwards writes, wrong LaunchedEffect keys, stale callbacks without rememberUpdatedState, missing DisposableEffect cleanup, coroutines launched during composition and reloads after configuration changes.
priority: 64
tags: [CWE-835, CWE-401]
activation:
  content:
    - '\bLaunchedEffect\s*\('
    - '\bDisposableEffect\s*\('
    - '\bSideEffect\s*\{'
    - '\brememberUpdatedState\s*\('
    - '\brememberCoroutineScope\s*\('
    - '\bproduceState\s*[<(]'
    - '\b(?:navigate|popBackStack)\s*\('
  examples:
    - 'LaunchedEffect(userId) { viewModel.load(userId) }'
    - 'DisposableEffect(lifecycleOwner) { onDispose { observer.remove() } }'
    - 'SideEffect { analytics.logScreen(name) }'
    - 'val current by rememberUpdatedState(onTimeout)'
    - 'val scope = rememberCoroutineScope()'
    - 'val elapsed by produceState(initialValue = 0) { value = tick() }'
    - 'navController.navigate("details/$id")'
sources:
  - https://developer.android.com/develop/ui/compose/side-effects
  - https://developer.android.com/develop/ui/compose/performance/bestpractices#avoid-backwards
  - https://developer.android.com/develop/ui/compose/architecture
---
- **Work in the composable body**: network calls, analytics, `viewModel.load()`, `navController.navigate()` or `scope.launch {}` directly in composition run on every recomposition (and can loop). Fix: event callbacks or an effect.
- **Backwards writes**: writing state already read in the same composition (`Text("$count"); count++`) → infinite recomposition. Fix: write only from callbacks or effects.
- **LaunchedEffect keys**: `LaunchedEffect(Unit)` whose block reads changing parameters keeps using the first values; keys that change constantly (whole UI state, new lambdas) cancel and restart it repeatedly. Fix: key on exactly the inputs that should restart it.
- **Stale callbacks**: long-running effects (`delay`, collectors) calling `onTimeout`/`onEvent` captured at launch → an outdated callback runs. Fix: `val current by rememberUpdatedState(onTimeout)` inside the effect.
- **Missing cleanup**: listeners or observers added in `LaunchedEffect`/`SideEffect`, or a `DisposableEffect` whose `onDispose` doesn't remove them (or keyed on the wrong owner) → leaks and duplicate callbacks. Fix: `DisposableEffect(owner) { add(o); onDispose { remove(o) } }`.
- **Reload on recreation**: `LaunchedEffect(Unit) { viewModel.load() }` reruns after rotation or returning to the screen → duplicate requests and flicker. Fix: start loading in the ViewModel (`init` or `stateIn(WhileSubscribed)`).
