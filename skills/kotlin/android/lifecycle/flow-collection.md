---
name: Lifecycle-aware Flow collection
description: Collecting flows from Android UI — collection continuing while stopped, deprecated launchWhenX, collectors registered repeatedly, sequential collects that never run, fragment owners and sharing policies that keep upstreams alive in background.
priority: 64
tags: [CWE-400, CWE-401]
activation:
  content:
    - '\blifecycleScope\.launch(?:When\w+)?\s*[({]'
    - '\blaunchWhen(?:Created|Started|Resumed)\b'
    - '\brepeatOnLifecycle\s*\('
    - '\bflowWithLifecycle\s*\('
    - '\.(?:collect|collectLatest)\s*[({]'
    - '\bSharingStarted\.(?:Eagerly|Lazily|WhileSubscribed)\b'
  examples:
    - 'lifecycleScope.launch { flow.collect { render(it) } }'
    - 'lifecycleScope.launchWhenStarted { collectData() }'
    - 'repeatOnLifecycle(Lifecycle.State.STARTED) { flow.collect { render(it) } }'
    - 'flow.flowWithLifecycle(lifecycle, Lifecycle.State.STARTED).collect { render(it) }'
    - 'stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), initial)'
sources:
  - https://developer.android.com/kotlin/flow/stateflow-and-sharedflow
  - https://developer.android.com/topic/libraries/architecture/coroutines#restart
  - https://developer.android.com/jetpack/androidx/releases/lifecycle
---
- **Collecting while stopped**: `lifecycleScope.launch { flow.collect { render(it) } }` keeps collecting in the background (unlike LiveData) → wasted work, view updates while stopped, crashes. Fix: `repeatOnLifecycle(Lifecycle.State.STARTED)` or `flowWithLifecycle`.
- **launchWhenX**: deprecated `launchWhenStarted`/`launchWhenResumed` only suspend the collector; upstream producers (location, sockets, DB observers) keep running in background. Fix: `repeatOnLifecycle`.
- **Re-registering**: `repeatOnLifecycle`/`collect` started in `onStart`/`onResume`, or in `onViewCreated` of a fragment via `lifecycleScope` → an extra collector per visit or collectors outliving the view. Fix: start once in `onCreate`, or `viewLifecycleOwner.lifecycleScope` in fragments.
- **Sequential collects**: `repeatOnLifecycle(STARTED) { a.collect {…}; b.collect {…} }` → `b` never collected because `a` never completes. Fix: `launch` each collector inside the block.
- **Upstream kept alive**: `stateIn(viewModelScope, SharingStarted.Eagerly/Lazily, …)` keeps location/network/DB upstreams active while the app is backgrounded. Fix: `SharingStarted.WhileSubscribed(5_000)` (survives rotation, stops in background).
