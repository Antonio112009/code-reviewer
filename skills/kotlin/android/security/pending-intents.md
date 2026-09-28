---
name: PendingIntent
description: PendingIntent defects — missing mutability flags (crash on targetSdk 31+), mutable implicit intents (hijackable, exception on 34+), extras-only differences overwriting each other, replayable one-time actions, notification trampolines and background-activity-launch opt-ins.
priority: 70
tags: [CWE-927, CWE-285]
activation:
  content:
    - '\bPendingIntent\.(?:getActivity|getActivities|getService|getForegroundService|getBroadcast)\s*\('
    - '\bPendingIntentCompat\b'
    - '\bFLAG_(?:MUTABLE|IMMUTABLE|UPDATE_CURRENT|ONE_SHOT|NO_CREATE|CANCEL_CURRENT)\b'
    - '\bsetPendingIntent(?:Creator|)BackgroundActivityStartMode\b'
    - '\bsetContentIntent\s*\('
  examples:
    - 'val pi = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE)'
    - 'val pi = PendingIntentCompat.getActivity(context, 0, intent, 0, false)'
    - 'options.setPendingIntentBackgroundActivityStartMode(MODE_BACKGROUND_ACTIVITY_START_ALLOWED)'
    - 'notificationBuilder.setContentIntent(pendingIntent)'
sources:
  - https://developer.android.com/privacy-and-security/risks/pending-intent
  - https://developer.android.com/reference/android/app/PendingIntent
  - https://developer.android.com/about/versions/14/behavior-changes-14
  - https://developer.android.com/guide/components/activities/background-starts
---
- **No mutability flag**: on targetSdk 31+ creating a `PendingIntent` without `FLAG_IMMUTABLE` or `FLAG_MUTABLE` throws `IllegalArgumentException` → crash when the notification or alarm is built. Fix: `FLAG_IMMUTABLE` unless a field must be filled in.
- **Mutable + implicit**: `FLAG_MUTABLE` with an implicit base intent lets the receiving app fill in component/action/data → access to unexported components; targetSdk 34+ throws unless `FLAG_ALLOW_UNSAFE_IMPLICIT_INTENT`. Fix: explicit component and immutable.
- **Extras don't distinguish**: intents differing only in extras are the same `PendingIntent` → `FLAG_UPDATE_CURRENT` rewrites every earlier notification's extras, `FLAG_NO_CREATE` finds the old one → wrong item opened. Fix: unique `requestCode` or data URI.
- **Replay**: a leaked `PendingIntent` for a one-time action (confirm, pay, delete) without `FLAG_ONE_SHOT` can be sent repeatedly. Fix: `FLAG_ONE_SHOT`.
- **Notification trampolines**: a notification whose `PendingIntent` targets a receiver or service that then starts an activity is blocked on targetSdk 31+ → tap does nothing. Fix: `PendingIntent.getActivity` directly.
- **Background activity launch**: on 14/15+ creators and senders must opt in (`ActivityOptions.setPendingIntent…BackgroundActivityStartMode`); Android 17 deprecates `MODE_BACKGROUND_ACTIVITY_START_ALLOWED` for `…ALLOW_IF_VISIBLE` → activity silently not started. Fix: opt in explicitly where required.
