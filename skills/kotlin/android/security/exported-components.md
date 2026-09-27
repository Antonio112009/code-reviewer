---
name: Exported components and broadcasts
description: Android IPC exposure — exported activities, services, receivers and providers without permissions, weak or mistyped custom permissions, caller checks that prove nothing, and broadcasts that leak data or accept spoofed input.
priority: 72
tags: [CWE-926, CWE-927, CWE-285, OWASP-A01]
activation:
  content:
    - 'android:(?:exported|permission|protectionLevel|grantUriPermissions)\b'
    - '<(?:activity|activity-alias|service|receiver|provider|permission)\b'
    - '<intent-filter\b'
    - '\bsend(?:Ordered|Sticky)?Broadcast(?:AsUser)?\s*\('
    - '\bRECEIVER_EXPORTED\b'
    - '\b(?:getCallingActivity|getCallingPackage|callingActivity|callingPackage|checkCallingPermission|checkCallingOrSelfPermission|getCallingUid)\b'
sources:
  - https://developer.android.com/privacy-and-security/risks/android-exported
  - https://developer.android.com/privacy-and-security/risks/access-control-to-exported-components
  - https://developer.android.com/privacy-and-security/risks/custom-permissions
  - https://developer.android.com/privacy-and-security/risks/insecure-broadcast-receiver
---
- **Exported without protection**: `android:exported="true"` (or an `<intent-filter>` on apps built for targetSdk < 31) on components that perform sensitive actions, with no `android:permission` → any app starts internal screens, services or receivers. Fix: `exported="false"`, or a `signature` permission.
- **Weak custom permissions**: sensitive IPC guarded by a custom permission with `protectionLevel` `normal`/`dangerous`, or a typo'd/undeclared permission name → any app can request or define it and pass the check. Fix: declared `signature` permissions, names copied from one constant.
- **Exported providers**: `<provider android:exported="true">` without `readPermission`/`writePermission` (or path permissions) → other apps query, insert or open files. Fix: not exported plus `grantUriPermissions` for one-off sharing.
- **Caller checks that prove nothing**: trusting `getCallingActivity() != null`, `callingPackage` from extras, or treating `checkCallingPermission()` as throwing (it returns an int) → spoofed callers pass. Fix: enforce manifest permissions; compare `PERMISSION_GRANTED`.
- **Leaky broadcasts**: `sendBroadcast(intent)` with tokens/PII and no `setPackage`/receiver permission, sticky broadcasts, or ordered broadcasts trusted after lower receivers → other apps read, alter or abort them. Fix: explicit package + permission; in-process use Flow instead.
- **Spoofable receivers**: an internal action registered with `RECEIVER_EXPORTED` or an exported manifest receiver that acts on extras without a sender permission → other apps trigger the action. Fix: `RECEIVER_NOT_EXPORTED` / `android:permission`.
