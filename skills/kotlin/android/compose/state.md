---
name: Compose state
description: Compose state bugs — mutable collections inside state, state created without remember, remember/derivedStateOf missing keys for plain parameters, remember instead of rememberSaveable for user input, unsaveable types and lifecycle-unaware collectAsState.
priority: 64
tags: [CWE-665]
activation:
  content:
    - '\bmutableStateOf\s*[<(]'
    - '\bmutable(?:StateList|StateMap|IntState|LongState|FloatState)Of\s*[<(]'
    - '\bremember(?:Saveable)?\s*[({<]'
    - '\bderivedStateOf\s*\{'
    - '\bcollectAsState(?:WithLifecycle)?\s*\('
  examples:
    - 'var text by remember { mutableStateOf("") }'
    - 'val items = mutableStateListOf<Item>()'
    - 'val filtered by remember { derivedStateOf { items.filter { it.price > limit } } }'
    - 'val state by viewModel.uiState.collectAsStateWithLifecycle()'
sources:
  - https://developer.android.com/develop/ui/compose/state
  - https://developer.android.com/develop/ui/compose/state-saving
  - https://developer.android.com/develop/ui/compose/side-effects#derivedstateof
  - https://developer.android.com/topic/libraries/architecture/coroutines
---
- **Mutable collections as state**: `mutableStateOf(mutableListOf())` or an `ArrayList` mutated with `add`/`remove` → Compose sees no write, UI stays stale. Fix: `mutableStateListOf()` or assign a new immutable list.
- **State without remember**: `var text by mutableStateOf("")` in a composable body (no `remember`) → reset on every recomposition; typed input disappears. Fix: `remember { mutableStateOf("") }`.
- **Missing remember keys**: `remember { format(price) }` or `remember { mutableStateOf(initial) }` keeps the first value when the parameter changes → stale derived values. Fix: `remember(price) { … }`, or hoist state.
- **derivedStateOf over plain params**: `remember { derivedStateOf { items.filter { it.price > limit } } }` where `items`/`limit` are ordinary parameters, not `State` → never recalculated. Fix: `remember(items, limit) { derivedStateOf { … } }`.
- **remember vs rememberSaveable**: text input, selection or dialog visibility in `remember` → lost on rotation and process death. Fix: `rememberSaveable`; non-Bundle types need `@Parcelize` or a `Saver` (else crash on save), and keep it small.
- **Lifecycle-unaware collection**: `flow.collectAsState()` on Android keeps collecting while the app is in background → wasted work and upstreams kept alive. Fix: `collectAsStateWithLifecycle()`.
