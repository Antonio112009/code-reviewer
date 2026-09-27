---
name: Release build configuration
description: Release-variant defects in Android Gradle config — debuggable release builds, secrets baked into the APK, targetSdk silently following compileSdk (AGP 9), resource shrinking removing dynamically looked-up resources and 16 KB page-size alignment for native libraries.
priority: 62
tags: [CWE-489, CWE-798]
activation:
  content:
    - '\b(?:isDebuggable|debuggable)\b'
    - '\b(?:buildConfigField|resValue|manifestPlaceholders)\b'
    - '\b(?:compileSdk|targetSdk)(?:Version)?\b'
    - '\b(?:isShrinkResources|shrinkResources)\b|\bgetIdentifier\s*\('
    - '\buseLegacyPackaging\b|\bndkVersion\b|\bexternalNativeBuild\b'
sources:
  - https://developer.android.com/privacy-and-security/risks/android-debuggable
  - https://developer.android.com/privacy-and-security/risks/hardcoded-cryptographic-secrets
  - https://developer.android.com/build/releases/agp-9-0-0-release-notes
  - https://developer.android.com/guide/practices/page-sizes
---
- **Debuggable release**: `isDebuggable = true` on a release build type or `android:debuggable="true"` → debugger attach, `run-as` access to private data, and `<debug-overrides>` (user CAs) become active. Fix: never debuggable outside debug variants.
- **Secrets in the APK**: API keys, tokens or signing secrets injected via `buildConfigField`, `resValue`, `manifestPlaceholders` or `local.properties` → extractable from every installed APK. Fix: keep secrets server-side; use restricted, rotatable client keys.
- **targetSdk follows compileSdk (AGP 9)**: with no explicit `targetSdk`, AGP 9 defaults it to `compileSdk` → raising compileSdk silently opts into new platform behavior changes. Fix: set `targetSdk` explicitly and review the behavior changes when raising it.
- **Resource shrinking vs dynamic lookup**: `isShrinkResources = true` (AGP 9: optimized shrinking always on) removes resources reached only through `getIdentifier("icon_$name", …)` → `Resources.NotFoundException` in release. Fix: `tools:keep` in `res/raw/keep.xml`, or static references.
- **16 KB pages**: native `.so` files (own or from SDKs) must be 16 KB-aligned for Android 15+ devices on Google Play; AGP < 8.5.1, NDK < r28 or hard-coded 4096-byte pages break installs. Fix: update AGP, NDK, SDKs.
