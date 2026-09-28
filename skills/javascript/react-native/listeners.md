---
name: App lifecycle and native listeners
description: AppState / BackHandler / Keyboard / Dimensions / Linking subscription defects — removed removeEventListener APIs, missing cleanup, BackHandler return values and Modal blind spot, iOS-only inactive state and iOS-only keyboard will-events.
priority: 60
activation:
  content:
    - '\b(?:AppState|BackHandler|Keyboard|Dimensions|Appearance|AccessibilityInfo|Linking)\.(?:addEventListener|removeEventListener|addListener|removeListener)\b'
    - '\b(?:NativeEventEmitter|DeviceEventEmitter)\b'
    - '\bhardwareBackPress\b|\bkeyboard(?:Will|Did)(?:Show|Hide)\b'
  examples:
    - "const sub = AppState.addEventListener('change', handleChange);"
    - 'const emitter = new NativeEventEmitter(NativeModule);'
    - "Keyboard.addListener('keyboardDidShow', onShow);"
sources:
  - https://reactnative.dev/docs/appstate
  - https://reactnative.dev/docs/backhandler
  - https://reactnative.dev/docs/keyboard
  - https://reactnative.dev/blog/2025/01/21/version-0.77
---
- **Removed unsubscribe APIs**: `AppState`/`Linking`/`Dimensions.removeEventListener` and `Keyboard.removeListener` (removed in older releases) or `BackHandler.removeEventListener` (removed in 0.77) → TypeError on unmount. Fix: keep the subscription returned by `addEventListener` and call `.remove()`.
- **No cleanup**: listeners added in effects without returning `() => sub.remove()` → duplicate handlers after remounts, leaks, callbacks on unmounted screens. Fix: return the cleanup.
- **BackHandler return value**: a handler that handles the press but doesn't return `true` → earlier handlers run or the app exits; returning `true` unconditionally → back button dead app-wide. Also no events while a `Modal` is open → use its `onRequestClose`.
- **AppState on iOS**: privacy screens, media pausing or app locks keyed only to `'background'` miss iOS-only `'inactive'` (app switcher, calls); logic waiting for `'inactive'` never runs on Android. Fix: handle both states per platform.
- **Keyboard will-events**: layout driven by `keyboardWillShow`/`keyboardWillHide` → never fire on Android. Fix: `keyboardDidShow`/`keyboardDidHide` there.
