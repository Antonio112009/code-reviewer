---
name: Timers
description: Timer defects — System.Threading.Timer collected while active, overlapping callbacks from System.Threading/System.Timers timers, crash-or-swallow exception behaviour, async void callbacks, and callbacks running after Stop/Dispose.
priority: 58
tags: [CWE-362, CWE-248]
activation:
  content:
    - '\bSystem\.(?:Threading|Timers)\.Timer\b|\bnew\s+Timer\(|\bTimerCallback\b'
    - '\bPeriodicTimer\b|\.Elapsed\s*\+=|\bCreateTimer\('
sources:
  - https://learn.microsoft.com/en-us/dotnet/api/system.threading.timer
  - https://learn.microsoft.com/en-us/dotnet/api/system.timers.timer
  - https://learn.microsoft.com/en-us/dotnet/api/system.threading.periodictimer
---
- **Timer collected**: a `System.Threading.Timer` referenced only by a local variable can be garbage-collected while active → callbacks stop at a random moment. Fix: keep it in a field and dispose it.
- **Overlapping callbacks**: `System.Threading.Timer` and `System.Timers.Timer` (`AutoReset = true`) fire on pool threads even while the previous callback is still running → concurrent executions, duplicated jobs. Fix: `PeriodicTimer` loop (.NET 6+) or a one-shot timer re-armed after the work.
- **Exception behaviour**: an exception in a `System.Threading.Timer` callback crashes the process; `System.Timers.Timer` swallows synchronous exceptions from `Elapsed` (the job silently stops working) but not those thrown after an `await`. Fix: try/catch and log in every callback.
- **Async callbacks**: `new Timer(async _ => …)` or `Elapsed += async (s, e) => …` are `async void` → overlap plus crash-on-exception. Fix: `while (await timer.WaitForNextTickAsync(ct)) { … }`.
- **After stop/dispose**: callbacks already queued can run after `Dispose()`/`Stop()` → they touch disposed resources. Fix: `DisposeAsync`/`Dispose(WaitHandle)` to wait, or a disposed flag checked in the callback.
