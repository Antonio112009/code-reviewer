---
name: Runtime permissions
description: Android/iOS permission defects in React Native — truthy checks of PermissionsAndroid results, ignored never_ask_again, Android 13+ media and notification permissions, background location requested wrongly and missing iOS usage strings.
priority: 64
activation:
  content:
    - '\bPermissionsAndroid\b|react-native-permissions'
    - '\b(?:request|get)\w*PermissionsAsync\(|\buse\w*Permissions\('
    - '\b(?:POST_NOTIFICATIONS|READ_MEDIA_\w+|READ_EXTERNAL_STORAGE|ACCESS_BACKGROUND_LOCATION)\b'
    - '\bNS\w+UsageDescription\b'
  examples:
    - 'const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES);'
    - 'const { status } = await requestCameraPermissionsAsync();'
    - "NSCameraUsageDescription: 'Used to scan documents',"
sources:
  - https://reactnative.dev/docs/permissionsandroid
  - https://developer.android.com/about/versions/13/behavior-changes-13
  - https://developer.android.com/develop/sensors-and-location/location/permissions/background
  - https://docs.expo.dev/guides/permissions/
---
- **Truthy result check**: `if (await PermissionsAndroid.request(...))` → the result is a string (`'granted'`, `'denied'`, `'never_ask_again'`), always truthy → code proceeds when denied → native SecurityException or silent failure. Fix: compare with `PermissionsAndroid.RESULTS.GRANTED`.
- **Dead re-requests**: requesting again after `never_ask_again` / Expo `canAskAgain: false` → no dialog, the button does nothing. Fix: explain and `Linking.openSettings()`.
- **Android 13+ media and notifications**: targeting API 33+ yet requesting `READ_EXTERNAL_STORAGE` for photos (use `READ_MEDIA_IMAGES/VIDEO/AUDIO`), or never requesting `POST_NOTIFICATIONS` → empty pickers, notifications silently dropped. Fix: branch on `Platform.Version`.
- **Background location**: requesting `ACCESS_BACKGROUND_LOCATION` together with foreground location → on Android 11+ the dialog has no "Allow all the time" and it is not granted. Fix: foreground first, then background via settings with an explanation.
- **Missing iOS usage strings**: camera, photos, microphone, location or contacts accessed without the matching `NS…UsageDescription` (Info.plist or Expo `ios.infoPlist`/config plugin) → iOS terminates the app on first access; App Review rejects. Fix: add purpose strings in the native build.
- **Assuming a lasting grant**: permission checked once at startup and cached → users revoke it in Settings; later calls fail. Fix: `check`/`get…PermissionsAsync` before each use.
