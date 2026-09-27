---
name: Push notifications (expo-notifications)
description: expo-notifications defects — foreground notifications never shown, Android 13 permission prompt blocked by a missing channel, stale or misattributed push tokens, cold-start taps missed and listeners never removed.
priority: 58
activation:
  content:
    - 'expo-notifications|\bNotifications\.\w+'
    - '\b(?:getExpoPushTokenAsync|getDevicePushTokenAsync|setNotificationHandler|setNotificationChannelAsync|addPushTokenListener|useLastNotificationResponse)\b'
sources:
  - https://docs.expo.dev/versions/latest/sdk/notifications/
  - https://expo.dev/changelog/sdk-54
---
- **No foreground handler**: `setNotificationHandler` never called at startup → notifications arriving while the app is open are not displayed. Fix: set it at module scope.
- **Channel after permission (Android 13+)**: requesting permission or a push token before `setNotificationChannelAsync` → the OS permission prompt never appears; nothing is delivered. Fix: create the channel first.
- **Token lifecycle**: push token fetched once and cached forever, no `addPushTokenListener`, not re-registered after login/logout or user switch → pushes go to stale devices or the wrong account; `getExpoPushTokenAsync` without `projectId` fails outside EAS builds. Fix: re-register per user, pass `projectId`.
- **Cold-start taps missed**: tap handling only via `addNotificationResponseReceivedListener` → taps that launch the app are ignored. Fix: also `useLastNotificationResponse()`/`getLastNotificationResponse()`.
- **Listeners never removed**: subscriptions without `.remove()` (the `removeNotificationSubscription` export was removed in SDK 54) → duplicate handling after remounts or a TypeError on cleanup. Fix: `sub.remove()` in effect cleanup.
