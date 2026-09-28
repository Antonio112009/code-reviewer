---
name: Expo SDK 54–56 breaking changes
description: Expo SDK upgrade traps (SDK 54 ≈ RN 0.81, 55 ≈ 0.83, 56 ≈ 0.85) — expo-av removal, the new expo-file-system API and legacy import path, async File copy/move, expo-router dropping React Navigation, New Architecture-only builds and removed config fields.
priority: 60
activation:
  content:
    - 'expo-av|expo-file-system|@react-navigation/|@expo/vector-icons'
    - '\bnew (?:File|Directory)\(|\b(?:readAsStringAsync|writeAsStringAsync|documentDirectory|cacheDirectory)\b'
    - '\b(?:newArchEnabled|edgeToEdgeEnabled)\b'
  examples:
    - "import { Audio } from 'expo-av';"
    - "const file = new File(Paths.document, 'data.json');"
    - 'newArchEnabled: true,'
  files: ['**/app.config.{js,ts,mjs,cjs}']
  versions: { framework.react-native: '>=0.81' }
sources:
  - https://expo.dev/changelog/sdk-54
  - https://expo.dev/changelog/sdk-55
  - https://expo.dev/changelog/sdk-56
---
- **expo-av removed (SDK 55)**: `Audio`/`Video` from `expo-av` → module missing in builds and Expo Go. Fix: `expo-audio` and `expo-video`.
- **expo-file-system API switch (SDK 54)**: the package root now exports the object API (`File`, `Directory`, `Paths`); legacy functions (`readAsStringAsync`, `documentDirectory`…) moved to `expo-file-system/legacy`, scheduled for removal → undefined at runtime. Fix: migrate to the new API.
- **Async copy/move (SDK 56)**: `File`/`Directory` `copy()` and `move()` now return Promises → code using the destination right away races the operation. Fix: `await` them or use `copySync`/`moveSync`.
- **expo-router without React Navigation (SDK 56)**: expo-router no longer depends on `@react-navigation/*`; direct imports of hooks, themes or navigators stop working out of the box. Fix: run the codemod, use expo-router exports.
- **New Architecture only (SDK 55)**: `newArchEnabled: false` is gone and Android edge-to-edge is always on (`edgeToEdgeEnabled` removed) → legacy-only libraries fail; content under system bars. Fix: New Architecture-compatible libraries, safe-area insets.
- **Removed `notification` config (SDK 55)**: the app-config `notification` field is no longer read → notification icon/color settings silently lost. Fix: move them to the `expo-notifications` config plugin.
