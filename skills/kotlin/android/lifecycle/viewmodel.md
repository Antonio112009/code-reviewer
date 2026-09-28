---
name: ViewModel
description: ViewModel misuse — UI and Context references leaking across configuration changes, ViewModels constructed by hand, wrong ViewModelStore scope, state lost on process death, LiveData postValue coalescing and resources not released in onCleared.
priority: 64
tags: [CWE-401, CWE-404]
activation:
  content:
    - ':\s*(?:Android)?ViewModel\s*\('
    - '\bby\s+(?:viewModels|activityViewModels|navGraphViewModels)\b'
    - '\b(?:viewModel|hiltViewModel|koinViewModel)\s*[<(]'
    - '\bViewModelProvider\b'
    - '\bSavedStateHandle\b'
    - '\.postValue\s*\('
    - '\bonCleared\s*\('
  examples:
    - 'class DetailViewModel : ViewModel() {'
    - 'private val viewModel: DetailViewModel by viewModels()'
    - 'val viewModel: DetailViewModel = hiltViewModel()'
    - 'val viewModel = ViewModelProvider(this, factory)[DetailViewModel::class.java]'
    - 'class DetailViewModel(private val savedStateHandle: SavedStateHandle) : ViewModel() {'
    - '_state.postValue(UiState.Loading)'
    - 'override fun onCleared() { scope.cancel() }'
sources:
  - https://developer.android.com/topic/libraries/architecture/viewmodel
  - https://developer.android.com/topic/libraries/architecture/viewmodel/viewmodel-savedstate
  - https://developer.android.com/reference/androidx/lifecycle/LiveData#postValue(T)
  - https://developer.android.com/jetpack/androidx/releases/lifecycle
---
- **UI references**: a ViewModel holding an Activity, Fragment, View, non-application `Context`, `NavController` or callbacks capturing them → leaked across configuration changes, stale UI updated. Fix: application context only; expose state, let the UI act.
- **Hand-constructed ViewModel**: `MyViewModel(repo)` created in an Activity, Fragment or composable instead of `by viewModels()`/`viewModel()`/`hiltViewModel()` → new instance per recreation, state lost, `onCleared` never runs so `viewModelScope` is never cancelled. Fix: ViewModelProvider with a factory.
- **Wrong owner**: `activityViewModels()` or an Activity-scoped `viewModel()` for per-screen state → data leaks between screens; a plain `viewModels()` where two fragments must share → two diverging instances. Fix: pick the owner deliberately (nav graph/back-stack entry).
- **Process death**: user input, selections or navigation arguments held only in ViewModel fields → lost when the backgrounded process is killed. Fix: `SavedStateHandle` (`getStateFlow`, `saved {}`) for small UI state; persist the rest.
- **postValue coalescing**: several `postValue` calls before the main thread runs deliver only the last value (e.g. Loading → Success collapses, one-off errors vanish); `setValue` from a background thread throws. Fix: `StateFlow`/`update {}` or `setValue` on main.
- **Unreleased resources**: a ViewModel creating its own `CoroutineScope`, listeners or `Closeable`s without closing them in `onCleared`/`addCloseable` → leaks after the screen is gone. Fix: `viewModelScope`, `addCloseable`.
