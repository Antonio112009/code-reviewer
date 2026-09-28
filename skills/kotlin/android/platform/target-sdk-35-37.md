---
name: targetSdk 35–37 behavior changes
description: What breaks when targetSdk is raised to 35 (Android 15), 36 (Android 16) or 37 (Android 17) — edge-to-edge, predictive back, ignored orientation/resizability on large screens, fixed-rate scheduling, static-final reflection, widget bitmap limits and delayed SMS OTPs.
priority: 66
activation:
  content:
    - '\btargetSdk(?:Version)?\s*[=(]?\s*"?3[5-7]\b'
    - '\b(?:setStatusBarColor|setNavigationBarColor|setDecorFitsSystemWindows|windowOptOutEdgeToEdgeEnforcement|enableEdgeToEdge)\b'
    - '\bonBackPressed\s*\(|\bKEYCODE_BACK\b|\benableOnBackInvokedCallback\b'
    - '\b(?:screenOrientation|resizeableActivity|maxAspectRatio|minAspectRatio|setRequestedOrientation)\b'
    - '\bscheduleAtFixedRate\s*\('
    - '\bgetDeclaredField\s*\(|\bFIELD_MODIFIERS\b'
    - '\bRemoteViews\b|\bSMS_RECEIVED\b|\bwindowSoftInputMode\b'
  examples:
    - 'targetSdk = 36'
    - 'enableEdgeToEdge()'
    - 'override fun onBackPressed() { showExitDialog() }'
    - 'android:screenOrientation="portrait"'
    - 'timer.scheduleAtFixedRate(task, 0, 1000)'
    - 'val field = MyClass::class.java.getDeclaredField("count")'
    - 'val views = RemoteViews(packageName, R.layout.widget)'
sources:
  - https://developer.android.com/about/versions/15/behavior-changes-15
  - https://developer.android.com/about/versions/16/behavior-changes-16
  - https://developer.android.com/about/versions/17/behavior-changes-17
  - https://developer.android.com/about/versions/17/behavior-changes-all
---
- **Edge-to-edge (35, no opt-out on 36)**: content draws under system bars and the IME unless insets are applied; bar-color setters do nothing and `windowOptOutEdgeToEdgeEnforcement` is ignored on 36 → hidden buttons, inputs under the keyboard. Fix: `WindowInsets`/`Scaffold` insets, `imePadding()`.
- **Predictive back (36)**: `onBackPressed()` is no longer called and `KEYCODE_BACK` isn't dispatched → custom back handling (confirm dialogs, closing drawers) silently skipped. Fix: `OnBackPressedCallback`/`BackHandler`.
- **Large screens (36, forced on 37)**: on sw ≥ 600 dp `screenOrientation`, `resizeableActivity="false"`, aspect-ratio limits and `setRequestedOrientation` are ignored → stretched portrait UIs, more activity recreation. Fix: adaptive layouts and state that survives recreation.
- **Fixed-rate scheduling (36)**: `scheduleAtFixedRate` runs at most one missed execution when the app returns → tick counters and timers drift. Fix: compute from elapsed time.
- **Static final reflection (37)**: writing `static final` fields via reflection throws `IllegalAccessException` (JNI crashes). Fix: remove such hacks and outdated libraries.
- **Widget bitmaps (37)**: `RemoteViews` bitmaps above the memory limit (1.5 × screen pixels × 4 bytes) throw `IllegalArgumentException`. Fix: downscale before setting.
- **SMS OTPs (37)**: standard SMS one-time codes reach SMS readers only after 3 hours → OTP autofill via `SMS_RECEIVED`/READ_SMS stops working. Fix: SMS Retriever or User Consent API.
