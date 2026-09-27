---
name: Background execution
description: BackgroundTasks and background URLSession rules — launch-time registration, permitted identifiers and request limits, completion and expiration handling, balanced beginBackgroundTask calls, BGContinuedProcessingTask progress (iOS 26) and background transfer requirements.
activation:
  content:
    - '\bBG(?:TaskScheduler|AppRefreshTask(?:Request)?|ProcessingTask(?:Request)?|ContinuedProcessingTask(?:Request)?|Task)\b|\b(?:begin|end)BackgroundTask\b|\.backgroundTask\('
    - '\bURLSessionConfiguration\.background\b|\bhandleEventsForBackgroundURLSession\b|\burlSessionDidFinishEvents\b|\bdidFinishDownloadingTo\b'
    - '<key>(?:BGTaskSchedulerPermittedIdentifiers|UIBackgroundModes)</key>'
sources:
  - https://developer.apple.com/documentation/backgroundtasks/bgtaskscheduler/register(fortaskwithidentifier:using:launchhandler:)
  - https://developer.apple.com/documentation/backgroundtasks/bgtask/settaskcompleted(success:)
  - https://developer.apple.com/documentation/uikit/uiapplication/beginbackgroundtask(expirationhandler:)
  - https://developer.apple.com/documentation/foundation/downloading-files-in-the-background
---
- **Late registration**: `BGTaskScheduler.register(forTaskWithIdentifier:)` must finish before `application(_:didFinishLaunchingWithOptions:)` returns → registering later (a view, a lazily created manager) throws at runtime; registering an id twice kills the app.
- **Identifiers and limits**: ids missing from `BGTaskSchedulerPermittedIdentifiers` make `register` return `false`; more than 1 refresh or 10 processing requests → `tooManyPendingTaskRequests`. App-refresh requests are one-shot: submit the next one in the handler.
- **Completion and expiration**: handlers must set `expirationHandler` (cancel work) and call `setTaskCompleted(success:)` on every path → otherwise the system may kill the app.
- **beginBackgroundTask**: each `beginBackgroundTask` needs `endBackgroundTask` on success, failure and in the expiration handler (then reset the id to `.invalid`) → a leaked assertion gets the app terminated.
- **Continued processing (iOS 26)**: `BGContinuedProcessingTask` must start from a user action and update `progress` regularly → tasks showing little progress are terminated first.
- **Background URLSession**: needs a delegate (no completion-handler tasks), uploads only from files, and the same identifier recreated at launch; move the file before `didFinishDownloadingTo` returns and call the stored `handleEventsForBackgroundURLSession` handler on main after `urlSessionDidFinishEvents`.
