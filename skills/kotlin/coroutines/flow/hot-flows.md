---
name: StateFlow and SharedFlow
description: Hot-flow defects — StateFlow equality conflation hiding in-place mutations, dropped SharedFlow emissions and lost or replayed one-off events, stateIn/shareIn created per call, upstream failures that silently stop sharing and mutable flows exposed to callers.
priority: 64
tags: [CWE-362, CWE-400]
activation:
  content:
    - '\bMutable(?:State|Shared)Flow\s*[<(]'
    - '\.(?:stateIn|shareIn)\s*\('
    - '\.tryEmit\s*\('
    - '\bSharingStarted\.'
    - '\.value\s*='
    - '\bStateFlow<|\bSharedFlow<'
sources:
  - https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-state-flow/
  - https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-shared-flow/
  - https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/share-in.html
  - https://developer.android.com/topic/architecture/ui-layer/events
---
- **Equality conflation**: `StateFlow` drops a value `equals` to the current one → mutating a list/object in place and re-assigning the same instance never notifies collectors. Fix: emit new immutable instances (`copy()`, `toList()`).
- **Dropped emissions**: on a `MutableSharedFlow()` without replay/buffer, `tryEmit` never delivers — it returns `false` while subscribers exist and the value is lost when none do. Fix: `emit` from a coroutine, or size `extraBufferCapacity` and check the result.
- **One-off events**: navigation/snackbar events in `StateFlow` re-fire after rotation; in `SharedFlow`/`Channel` they are lost while the UI is stopped. Fix: model them as UI state the UI consumes and clears.
- **stateIn/shareIn per call**: `fun items() = repo.flow.stateIn(scope, …)` or a getter creates a new shared flow and upstream subscription per call → duplicate DB/network work, leaks. Fix: one property; `SharingStarted.WhileSubscribed(5_000)` for UI.
- **Upstream failure**: an exception in the `shareIn`/`stateIn` upstream ends sharing silently — subscribers stay on stale data — and goes to the scope's handler (crash in `viewModelScope`). Fix: `catch`/`retry` before sharing.
- **Mutable exposure**: a public `MutableStateFlow`/`MutableSharedFlow` (or an unwrapped `as StateFlow`) lets callers push state. Fix: private backing property plus `asStateFlow()`/`asSharedFlow()`.
