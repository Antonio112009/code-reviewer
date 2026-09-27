---
name: Main-process IPC handlers
description: ipcMain defects — unvalidated senders and arguments, senderFrame read after await (null since Electron 33), duplicate handle registration, sends to destroyed windows, synchronous IPC and lost error details.
priority: 76
tags: [CWE-20, CWE-22, CWE-78, CWE-346]
activation:
  content:
    - '\bipcMain\b|\bsenderFrame\b|\bMessageChannelMain\b'
    - '\bwebContents\.send\(|\.webContents\.send\(|\bevent\.reply\(|\bsendSync\(|\breturnValue\b'
sources:
  - https://www.electronjs.org/docs/latest/tutorial/security
  - https://www.electronjs.org/docs/latest/breaking-changes
  - https://www.electronjs.org/docs/latest/api/ipc-renderer
  - https://www.electronjs.org/docs/latest/api/ipc-main
---
- **Unvalidated sender**: handlers acting for any caller without checking `event.senderFrame` origin/URL → iframes, popups or navigated remote pages invoke privileged handlers. Fix: validate `senderFrame.url` against your app's origin.
- **Unvalidated arguments**: renderer-supplied paths, URLs, shell args or queries passed to `fs`, `exec`, `shell.openExternal` or the DB → traversal, RCE from a compromised renderer. Fix: schema-validate; resolve paths inside allowed roots.
- **senderFrame after `await` (33+)**: reading `event.senderFrame` after an `await` or in a later callback → `null` once the frame navigated or detached → TypeError or skipped check. Fix: read and validate it synchronously first.
- **Duplicate registration**: `ipcMain.handle` inside `createWindow()` → "Attempted to register a second handler" when a window is recreated (macOS `activate`). Fix: register once at startup or `removeHandler` first.
- **Sending to dead windows**: `win.webContents.send` from timers, watchers or download events after the window closed → "Object has been destroyed" exception in main. Fix: `isDestroyed()` guard, remove listeners on `closed`.
- **Synchronous IPC**: `ipcRenderer.sendSync` with `event.returnValue` handlers doing I/O → renderer frozen until main answers; a slow main stalls every window. Fix: `invoke`/`handle`.
- **Error details lost**: renderer code relying on custom error classes or fields thrown from `handle` → only the message crosses IPC. Fix: return `{ ok, error: { code } }` values.
