---
name: Alarms and broadcast receivers
description: AlarmManager and BroadcastReceiver defects — exact alarms without permission checks, revoked permissions, alarms lost on reboot, inexact windows, registerReceiver without export flags (targetSdk 34), dead manifest receivers for implicit broadcasts and long work in onReceive.
priority: 62
tags: [CWE-755, CWE-400]
activation:
  content:
    - '\bset(?:Exact|ExactAndAllowWhileIdle|AlarmClock|AndAllowWhileIdle|Window|Repeating|InexactRepeating)\s*\('
    - '\bcanScheduleExactAlarms\s*\(|\b(?:SCHEDULE|USE)_EXACT_ALARM\b'
    - '\bBOOT_COMPLETED\b'
    - '\bregisterReceiver\s*\('
    - '\bRECEIVER_(?:NOT_)?EXPORTED\b'
    - '\boverride\s+fun\s+onReceive\s*\(|\bgoAsync\s*\('
    - '<receiver\b'
  examples:
    - 'alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)'
    - 'if (alarmManager.canScheduleExactAlarms()) schedule()'
    - 'if (intent.action == "android.intent.action.BOOT_COMPLETED") rescheduleAlarms()'
    - 'ContextCompat.registerReceiver(context, receiver, filter, RECEIVER_NOT_EXPORTED)'
    - 'override fun onReceive(context: Context, intent: Intent) {'
    - '<receiver android:name=".BootReceiver" android:exported="false">'
sources:
  - https://developer.android.com/develop/background-work/services/alarms/schedule
  - https://developer.android.com/develop/background-work/background-tasks/broadcasts
  - https://developer.android.com/about/versions/14/behavior-changes-14
---
- **Unchecked exact alarms**: `setExact*`/`setAlarmClock` without a declared exact-alarm permission throw `SecurityException` (targetSdk 31+); `SCHEDULE_EXACT_ALARM` isn't pre-granted to fresh installs targeting 33+ on Android 14. Fix: `canScheduleExactAlarms()` first, fall back to inexact.
- **Revocation**: revoking `SCHEDULE_EXACT_ALARM` stops the app and cancels all its exact alarms. Fix: reschedule on `ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`; `USE_EXACT_ALARM` only for alarm/calendar apps (Play policy).
- **Reboot**: every alarm is cleared on reboot → reminders silently stop. Fix: reschedule from a `BOOT_COMPLETED` receiver (`RECEIVE_BOOT_COMPLETED`).
- **Inexact means late**: on Android 12+ inexact alarms may fire up to an hour late and windows under 10 minutes are stretched → user-visible times drift. Fix: exact alarms (with checks) or WorkManager for deferrable work.
- **registerReceiver flags (targetSdk 34)**: registering for non-system broadcasts without `RECEIVER_EXPORTED`/`RECEIVER_NOT_EXPORTED` → `SecurityException`. Fix: `ContextCompat.registerReceiver(…, RECEIVER_NOT_EXPORTED)`.
- **Dead manifest receivers**: manifest `<receiver>`s for implicit broadcasts (connectivity, custom implicit actions) aren't delivered since Android 8 unless exempt → the feature never runs. Fix: register at runtime or send explicit intents.
- **Work in onReceive**: network or DB calls in `onReceive` block the main thread (ANR); after it returns the process may be killed, and `goAsync()` buys only ~10 s. Fix: enqueue WorkManager.
