---
name: WorkManager
description: WorkManager defects — async work returned early from Worker, duplicate or reset enqueues, APPEND chains poisoned by failures, oversized input Data, expedited work on Android 11 and lower, long-running work without foreground types, ignored custom configuration and retry storms.
priority: 64
tags: [CWE-400, CWE-755]
activation:
  content:
    - ':\s*(?:Coroutine|Listenable|RxWorker)?Worker\s*\('
    - '\benqueue(?:UniqueWork|UniquePeriodicWork)?\s*\('
    - '\bExisting(?:Periodic)?WorkPolicy\.'
    - '\b(?:OneTimeWorkRequestBuilder|PeriodicWorkRequestBuilder|workDataOf|Data\.Builder)\b'
    - '\bsetExpedited\s*\(|\bgetForegroundInfo\b|\bsetForeground(?:Async)?\s*\('
    - '\bConfiguration\.Provider\b|\bWorkManagerInitializer\b'
    - '\bResult\.retry\s*\('
  examples:
    - 'class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {'
    - 'workManager.enqueueUniqueWork("sync", ExistingWorkPolicy.KEEP, request)'
    - 'val request = OneTimeWorkRequestBuilder<SyncWorker>().build()'
    - 'setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)'
    - 'class App : Application(), Configuration.Provider {'
    - 'return Result.retry()'
sources:
  - https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work
  - https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/manage-work
  - https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/long-running
  - https://developer.android.com/develop/background-work/background-tasks/persistent/configuration/custom-configuration
---
- **Async work in Worker**: `Worker.doWork()` that starts callbacks/threads and returns `Result.success()` → counted as finished; the process may die mid-task. Fix: `CoroutineWorker` or `ListenableWorker`.
- **Duplicate or reset work**: plain `enqueue()` on every app start → piles of identical workers; `REPLACE` cancels running work and restarts periodic schedules. Fix: `enqueueUniqueWork`/`enqueueUniquePeriodicWork` with `KEEP` or `UPDATE`.
- **Poisoned APPEND chains**: with `ExistingWorkPolicy.APPEND`, a failed or cancelled predecessor makes every appended request fail or cancel too. Fix: `APPEND_OR_REPLACE`.
- **Oversized Data**: input/output `Data` over 10 KB throws `IllegalStateException` at enqueue. Fix: pass IDs/URIs; keep payloads in Room or files.
- **Expedited on API ≤ 30**: `setExpedited(...)` without overriding `getForegroundInfo()` crashes on Android 11 and lower (runs as a foreground service there). Fix: implement `getForegroundInfo()`.
- **Long-running work**: work beyond ~10 minutes needs `setForeground()`; on targetSdk 34 its `ForegroundInfo` type must also be declared on `SystemForegroundService` (`tools:node="merge"`) → otherwise the work is stopped or crashes. Fix: declare both.
- **Custom configuration ignored**: `Configuration.Provider` without removing `androidx.work.WorkManagerInitializer` from the manifest → default factories/executors are used. Fix: `tools:node="remove"` it.
- **Retry storms**: `Result.retry()` for permanent failures (HTTP 4xx, bad input) → endless retries with backoff, battery and server load. Fix: `Result.failure()`, cap `runAttemptCount`.
