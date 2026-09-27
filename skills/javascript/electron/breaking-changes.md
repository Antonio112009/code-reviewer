---
name: Electron 30–44 breaking changes
description: Electron upgrade traps with runtime impact — File.path removal (32), BrowserView deprecation (30), navigation history API move (32), session preload API (35), clipboard renderer removal and async API (40/44) and silent utility-process rejections (37).
priority: 66
activation:
  content:
    - '\bfiles?\b[^\n]{0,40}\.path\b|\bdataTransfer\b|\bwebUtils\b'
    - '\bBrowserView\b|\bsetBrowserView\b|\b(?:set|get)Preloads\('
    - '\b(?:webContents|contents)\.(?:canGoBack|goBack|canGoForward|goForward|goToIndex|goToOffset|clearHistory)\('
    - '(?<![\w.])clipboard\.\w+\(|\belectron\.clipboard\b|\butilityProcess\b'
  versions: { framework.electron: '>=30' }
sources:
  - https://www.electronjs.org/docs/latest/breaking-changes
  - https://www.electronjs.org/docs/latest/api/web-utils
---
- **`File.path` removed (32)**: drag-and-drop or `<input type=file>` code reading `file.path` gets `undefined` → broken imports and uploads. Fix: `webUtils.getPathForFile(file)` in the preload.
- **`BrowserView` deprecated (30)**: new code on `BrowserView`/`setBrowserView` → breaks when it is removed. Fix: `WebContentsView` (bounds and lifecycle are handled differently).
- **Navigation history (32)**: `webContents.goBack()`, `canGoBack()`, `clearHistory()` etc. are deprecated → break on removal. Fix: `webContents.navigationHistory.*`.
- **Session preloads (35)**: `session.setPreloads`/`getPreloads` are deprecated → break on removal. Fix: `registerPreloadScript`/`getPreloadScripts`.
- **Clipboard (40/44)**: renderer `clipboard` deprecated in 40 and removed in 44; in 44 every clipboard method returns a Promise → `clipboard.readText()` used as a string yields `[object Promise]`. Fix: call from main/preload and `await`.
- **Utility process rejections (37)**: unhandled rejections in `utilityProcess` children now only warn → failures go silent, work stops unnoticed. Fix: `process.on('unhandledRejection', …)` that logs and exits.
