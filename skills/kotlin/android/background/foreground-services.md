---
name: Foreground services
description: Foreground-service crashes and silent failures by targetSdk — missing service types and permissions (34), late startForeground, background start restrictions (31), while-in-use sensor limits (34), dataSync/mediaProcessing timeouts and BOOT_COMPLETED limits (35) and background audio (37).
priority: 66
tags: [CWE-755]
activation:
  content:
    - '\bstartForeground(?:Service)?\s*\('
    - '\bServiceCompat\.startForeground\b'
    - '\bforegroundServiceType\b|\bFOREGROUND_SERVICE_TYPE_\w+'
    - '\bFOREGROUND_SERVICE(?:_\w+)?\b'
    - '\bonTimeout\s*\('
    - '\bForegroundServiceStartNotAllowedException\b'
    - '\bBOOT_COMPLETED\b'
    - '<service\b'
    - '\bMediaSessionService\b|\brequestAudioFocus\s*\('
  examples:
    - 'startForegroundService(Intent(this, SyncService::class.java))'
    - 'ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)'
    - '<service android:name=".SyncService" android:foregroundServiceType="dataSync" />'
    - '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />'
    - 'override fun onTimeout(startId: Int, fgsType: Int) { stopSelf() }'
    - 'catch (e: ForegroundServiceStartNotAllowedException) { fallbackToWorkManager() }'
    - 'if (intent.action == "android.intent.action.BOOT_COMPLETED") rescheduleWork()'
    - 'class PlaybackService : MediaSessionService() {'
sources:
  - https://developer.android.com/develop/background-work/services/fgs/launch
  - https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
  - https://developer.android.com/about/versions/15/behavior-changes-15
  - https://developer.android.com/about/versions/17/behavior-changes-17
---
- **Missing type or permission (targetSdk 34)**: `<service>` without `android:foregroundServiceType`, no `FOREGROUND_SERVICE_<TYPE>` permission, or the type's runtime permission not granted → `MissingForegroundServiceTypeException`/`SecurityException`. Location/camera/mic types started from background get no sensor access. Fix: declare both; check first.
- **Late startForeground**: after `startForegroundService()`, a service that returns early or awaits work before `startForeground()` → ANR/`ForegroundServiceDidNotStartInTimeException`. Fix: promote first in `onStartCommand`, then work; `stopSelf()` if impossible.
- **Background starts (targetSdk 31+)**: starting a foreground service while the app is in background (normal-priority push, sync timers) → `ForegroundServiceStartNotAllowedException`. Fix: expedited/long-running WorkManager, or start from visible UI.
- **Timeouts (targetSdk 35)**: `dataSync` and `mediaProcessing` share 6 hours per 24 h; if `onTimeout(int, int)` doesn't `stopSelf()` promptly → `RemoteServiceException` crash (`shortService` has a ~3 min limit). Fix: implement `onTimeout`.
- **BOOT_COMPLETED (targetSdk 35)**: starting `dataSync`, `camera`, `mediaPlayback`, `phoneCall`, `mediaProjection` or `microphone` services from a boot receiver → `ForegroundServiceStartNotAllowedException`. Fix: schedule WorkManager instead.
- **Background audio (targetSdk 37)**: playback, audio focus or volume changes from a non-visible app without a foreground media service fail silently (`AUDIOFOCUS_REQUEST_FAILED`). Fix: `MediaSessionService`-based playback.
