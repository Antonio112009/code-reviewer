---
name: Removed APIs (0.85+)
description: React Native 0.85–0.87 API removals that break at runtime or silently change behaviour — absoluteFillObject, InteractionManager, StatusBar/Modal props, boolean keyboardShouldPersistTaps, DrawerLayoutAndroid, deep imports and useColorScheme values.
priority: 64
activation:
  content:
    - '\b(?:absoluteFillObject|InteractionManager|DrawerLayoutAndroid)\b'
    - '<StatusBar\b|\bStatusBar\.set(?:BackgroundColor|Translucent|NetworkActivityIndicatorVisible)\b'
    - 'keyboardShouldPersistTaps(?:=\{|\s*:\s*)(?:true|false)\b'
    - 'react-native/Libraries/|\buseColorScheme\(|\bsetColorScheme\('
    - '<Modal\b[^>\n]{0,160}\banimated\b'
  examples:
    - "const style = { ...StyleSheet.absoluteFillObject, backgroundColor: 'black' };"
    - '<StatusBar backgroundColor="#000" translucent />'
    - '<ScrollView keyboardShouldPersistTaps={true}>'
    - 'const scheme = useColorScheme();'
    - '<Modal visible={open} animated transparent>{children}</Modal>'
  versions: { framework.react-native: '>=0.85' }
sources:
  - https://reactnative.dev/blog/2026/04/07/react-native-0.85
  - https://reactnative.dev/blog/2026/08/11/react-native-0.87
  - https://reactnative.dev/blog/2025/06/12/react-native-0.80
---
- **`StyleSheet.absoluteFillObject` (removed 0.85)**: spreading it now spreads `undefined` → overlays silently lose absolute positioning (JS) or fail to type-check. Fix: `StyleSheet.absoluteFill`.
- **`InteractionManager` (removed 0.87)**: `runAfterInteractions`/`createInteractionHandle` → TypeError at runtime. Fix: `requestIdleCallback` or `setTimeout`.
- **StatusBar and Modal props (removed 0.87)**: StatusBar `backgroundColor`, `translucent`, `networkActivityIndicatorVisible` and their setters; Modal `animated` → ignored or undefined-function crashes. Fix: edge-to-edge insets, `animationType`.
- **`DrawerLayoutAndroid` (removed 0.87)**: the import is undefined → render crash. Fix: `react-native-drawer-layout`.
- **Boolean `keyboardShouldPersistTaps` (0.87)**: `={true}`/`={false}` no longer supported → default `'never'` behaviour returns (taps swallowed). Fix: `'always'` or `'handled'`.
- **Deep imports**: `react-native/Libraries/...` paths (deprecated 0.80, type errors under the strict API default in 0.87, opt-out only until 0.88) → break on upgrade; Jest mocks of deep paths stop applying. Fix: root `react-native` exports.
- **Color scheme values (0.87)**: `useColorScheme()` returns `null`, never `'unspecified'`; `setColorScheme('unspecified')` is deprecated → dead comparisons, wrong theme fallback. Fix: handle `null`, use `'auto'`.
