---
name: EAS Update (expo-updates)
description: Over-the-air update defects — runtimeVersion not tracking native changes, native-only changes shipped OTA, reloads that discard user state, unguarded update calls in development, unsigned updates and launch-blocking fallback timeouts.
priority: 64
activation:
  content:
    - 'expo-updates|\bUpdates\.(?:checkForUpdateAsync|fetchUpdateAsync|reloadAsync)\b|\buseUpdates\b'
    - '\b(?:runtimeVersion|fallbackToCacheTimeout|checkAutomatically|codeSigning(?:Certificate|Metadata))\b'
sources:
  - https://docs.expo.dev/eas-update/runtime-versions/
  - https://docs.expo.dev/versions/latest/sdk/updates/
  - https://docs.expo.dev/eas-update/code-signing/
  - https://docs.expo.dev/guides/permissions/
---
- **runtimeVersion drift**: policy `appVersion` or a fixed string while native deps, config plugins or the SDK change unbumped → updates call native code the installed build lacks → crash or rollback. Fix: `fingerprint` policy or bump per native change.
- **Native changes shipped OTA**: updates that need new native modules, config plugins or `Info.plist`/permission strings → cannot be delivered over the air; features crash or silently fail. Fix: new store build.
- **Reload mid-session**: `fetchUpdateAsync()` followed immediately by `reloadAsync()` → unsaved input and navigation state lost; code after `await reloadAsync()` may never run. Fix: apply on next launch or ask the user.
- **Unguarded update calls**: `checkForUpdateAsync`/`fetchUpdateAsync` reject in development and can fail on network errors → unhandled rejections at startup. Fix: gate on `!__DEV__`/`Updates.isEnabled`, try/catch.
- **Unsigned updates**: apps with sensitive functionality shipping updates without end-to-end code signing (`codeSigningCertificate`/`codeSigningMetadata`) → they trust the CDN and hosting. Fix: enable update code signing.
- **Blocking launch**: `fallbackToCacheTimeout` > 0 → cold starts wait on the network for new updates (blank start on slow connections). Fix: `0` and apply updates on next launch.
