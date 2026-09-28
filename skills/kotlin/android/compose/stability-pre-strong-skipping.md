---
name: Compose stability before strong skipping (Kotlin < 2.0.20)
description: Recomposition cost on Kotlin < 2.0.20 / Compose compilers without strong skipping — unstable parameters that never skip, lambdas recreated on every recomposition, and the semantic change when strong skipping is turned on.
priority: 58
activation:
  versions: { lang.kotlin: "<2.0.20" }
  content:
    - '@Composable\s+(?:(?:private|internal)\s+)?fun\s+\w+\s*\([^)\n]{0,200}\b(?:List|Set|Map|Collection)<'
    - '\benableStrongSkippingMode\b|\bstabilityConfigurationFile\b|\bcomposeCompiler\s*\{'
    - '\bcomposeOptions\s*\{|\bkotlinCompilerExtensionVersion\b'
    - '@(?:Stable|Immutable)\b'
  examples:
    - '@Composable fun UserList(users: List<User>) {'
    - 'composeCompiler { enableStrongSkippingMode = true }'
    - 'composeOptions { kotlinCompilerExtensionVersion = "1.5.14" }'
    - '@Immutable data class UiState(val items: List<Item>)'
sources:
  - https://developer.android.com/develop/ui/compose/performance/stability
  - https://developer.android.com/develop/ui/compose/performance/stability/fix
  - https://developer.android.com/develop/ui/compose/performance/stability/strongskipping
---
- **Unstable parameters never skip**: `List`/`Set`/`Map` parameters, classes with `var`s, or classes from modules without the Compose compiler are unstable → the composable re-runs on every parent recomposition. Fix: immutable collections, a stability configuration file, or Kotlin ≥ 2.0.20.
- **Recreated lambdas**: lambdas capturing unstable values are not remembered → a new instance each recomposition, so children receiving them never skip either. Fix: `remember(key) { { … } }`, stable captures, or strong skipping.
- **Turning strong skipping on**: enabling the flag or upgrading to Kotlin 2.0.20+ (default there) compares unstable parameters by instance → UI that relied on always recomposing with in-place-mutated objects shows stale data. Fix: make those models immutable first.
