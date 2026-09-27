---
tier: full
name: Safe areas and edge-to-edge
description: Layout defects from Android edge-to-edge (forced by targetSdk 35, mandatory on Android 16) and notches — deprecated core SafeAreaView, hard-coded status-bar offsets, ignored StatusBar props and missing bottom insets.
priority: 58
activation:
  content:
    - '\bSafeAreaView\b|\buseSafeAreaInsets\b|\bSafeAreaProvider\b|react-native-safe-area-context'
    - '<StatusBar\b|\bStatusBar\.(?:currentHeight|set\w+)'
    - '\b(?:edgeToEdge\w*|statusBarTranslucent|navigationBarTranslucent)\b'
sources:
  - https://reactnative.dev/blog/2025/08/12/react-native-0.81
  - https://reactnative.dev/blog/2026/08/11/react-native-0.87
  - https://developer.android.com/develop/ui/views/layout/edge-to-edge
---
- **Core SafeAreaView**: `SafeAreaView` from `react-native` pads only on iOS (deprecated in 0.81) → on Android 15+ edge-to-edge, headers and buttons render under the status bar and taps hit the gesture area. Fix: `react-native-safe-area-context` (`SafeAreaView`, `useSafeAreaInsets`).
- **Hard-coded offsets**: `paddingTop: 20/44`, `StatusBar.currentHeight` math or iOS-only padding → overlaps on notches, Dynamic Island, Android cutouts and in landscape. Fix: use insets.
- **StatusBar props ignored**: `backgroundColor`/`translucent` have no effect under edge-to-edge (removed in 0.87) → status-bar icons unreadable over content. Fix: draw a background behind the top inset and set `barStyle`.
- **Bottom bars**: tab bars, FABs, sticky buttons at `bottom: 0` without `insets.bottom` → covered by the home indicator or 3-button navigation. Fix: add bottom inset.
