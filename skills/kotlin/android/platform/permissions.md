---
name: Runtime permissions and notifications
description: Permission defects by API level — APIs used without checks, permanent-denial loops, location request rules (30/31), notification permission and channels (26/33), media and storage permissions (30/33/34) and the local-network permission (targetSdk 37).
priority: 64
tags: [CWE-280, CWE-755]
activation:
  content:
    - '\b(?:checkSelfPermission|requestPermissions|shouldShowRequestPermissionRationale)\s*\('
    - '\bActivityResultContracts\.RequestMultiplePermissions\b|\bRequestPermission\s*\('
    - '\b(?:ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION|ACCESS_BACKGROUND_LOCATION|POST_NOTIFICATIONS|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA_\w+|ACCESS_LOCAL_NETWORK|NEARBY_WIFI_DEVICES|BLUETOOTH_(?:SCAN|CONNECT))\b'
    - '\brequestLegacyExternalStorage\b'
    - '<uses-permission\b'
    - '\b(?:NotificationManagerCompat|NotificationChannel)\b|\.notify\s*\('
sources:
  - https://developer.android.com/training/permissions/requesting
  - https://developer.android.com/develop/sensors-and-location/location/permissions
  - https://developer.android.com/develop/ui/views/notifications/notification-permission
  - https://developer.android.com/about/versions/17/behavior-changes-17
---
- **Use without a check**: location, camera, Bluetooth (`BLUETOOTH_SCAN/CONNECT`, 31+) or contacts APIs called on paths that skip `checkSelfPermission` → `SecurityException`, since users revoke and the system auto-resets permissions. Fix: check right before use.
- **Permanent denial**: re-requesting after "Don't ask again" shows no dialog → the feature is silently dead. Fix: when denied and `shouldShowRequestPermissionRationale` is false, explain and link to app settings.
- **Location rules**: targetSdk 31+ ignores a request for `ACCESS_FINE_LOCATION` alone and users may grant only approximate; Android 11+ ignores foreground and background location requested together. Fix: request coarse+fine, then background separately.
- **Notifications**: on targetSdk 33+ notifications are dropped until `POST_NOTIFICATIONS` is granted; on API 26+ a notification without an existing channel never shows. Fix: request in context, create channels first, check `areNotificationsEnabled()`.
- **Media and storage**: `READ_EXTERNAL_STORAGE` does nothing on targetSdk 33+ (use `READ_MEDIA_*`); Android 14 users may grant only selected photos (`READ_MEDIA_VISUAL_USER_SELECTED`); `WRITE_EXTERNAL_STORAGE`/`requestLegacyExternalStorage` are ignored from targetSdk 30. Fix: Photo Picker, MediaStore/SAF, handle partial grants.
- **Local network (targetSdk 37)**: mDNS/`NsdManager` discovery and connections to LAN addresses need the runtime `ACCESS_LOCAL_NETWORK` permission → `EPERM`/failed sockets otherwise. Fix: declare and request it before LAN features.
