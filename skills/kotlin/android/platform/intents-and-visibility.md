---
name: Intents and package visibility
description: Outgoing intent defects — package-visibility filtering (targetSdk 30), unhandled ActivityNotFoundException, implicit intents to the app's own unexported components (targetSdk 34), startActivity from non-activity contexts, background activity starts and intent-filter matching rules.
priority: 62
tags: [CWE-755]
activation:
  content:
    - '\b(?:queryIntentActivities|queryIntentServices|resolveActivity|getPackageInfo|getInstalledApplications|getInstalledPackages)\s*\('
    - '<queries\b|\bQUERY_ALL_PACKAGES\b'
    - '\bstartActivity(?:ForResult)?\s*\('
    - '\bIntent\s*\(\s*(?:Intent\.)?ACTION_\w+'
    - '\bIntent\s*\(\s*"[\w.]+"\s*\)'
    - '\bFLAG_ACTIVITY_NEW_TASK\b|\bintentMatchingFlags\b'
  examples:
    - 'val resolved = packageManager.resolveActivity(intent, 0)'
    - '<queries><package android:name="com.example.other" /></queries>'
    - 'startActivity(intent)'
    - 'val intent = Intent(Intent.ACTION_VIEW, uri)'
    - 'val intent = Intent("com.example.app.ACTION_SYNC")'
    - 'intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)'
sources:
  - https://developer.android.com/training/package-visibility
  - https://developer.android.com/training/package-visibility/use-cases
  - https://developer.android.com/about/versions/14/behavior-changes-14
  - https://developer.android.com/guide/components/activities/background-starts
---
- **Package visibility**: on targetSdk 30+ `queryIntentActivities`, `resolveActivity` and `getPackageInfo` see only packages covered by `<queries>` → availability checks return empty/null and share or payment buttons silently vanish. Fix: `<queries>`, or start the intent and catch.
- **Unhandled ActivityNotFoundException**: `startActivity` for implicit intents (browser, mail, dialer, OEM settings screens) without try/catch → crash on devices with no handler. Fix: catch and fall back.
- **Implicit intents to own components (targetSdk 34)**: implicit intents reach only exported components → `startActivity(Intent("com.app.ACTION"))` aimed at the app's own unexported activity throws `ActivityNotFoundException`. Fix: `setPackage(packageName)` or an explicit component.
- **Non-activity context**: `startActivity` from an `Application`, `Service` or receiver context without `FLAG_ACTIVITY_NEW_TASK` → `AndroidRuntimeException`. Fix: add the flag or use an Activity context.
- **Background activity starts**: launching activities from services, receivers or delayed callbacks while the app is in background is blocked (Android 10+) → nothing appears. Fix: a notification (full-screen intent only for calls/alarms) or a user-initiated `PendingIntent`.
- **Intent-filter matching**: explicit intents to another app targeting 33+ must match its `<intent-filter>`; Android 16's opt-in `intentMatchingFlags="enforceIntentFilter"` also blocks action-less intents → cross-app calls dropped. Fix: include a matching action/data.
