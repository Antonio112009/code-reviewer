---
name: Main process reliability
description: Electron main-process defects — garbage-collected Tray objects, blocking sync work that freezes all windows, trusted deep-link argv, missed launch URLs without single-instance lock, unhandled renderer crashes and secrets stored without safeStorage.
priority: 66
tags: [CWE-400, CWE-312, CWE-20]
activation:
  content:
    - '\bnew (?:Tray|BrowserWindow|Notification)\('
    - '\bapp\.(?:whenReady|requestSingleInstanceLock|setAsDefaultProtocolClient)\('
    - '[''"](?:second-instance|open-url|render-process-gone|child-process-gone|unresponsive)[''"]'
    - '\bsafeStorage\b|\belectron-store\b|\b(?:readFileSync|execSync|spawnSync)\('
  examples:
    - 'const win = new BrowserWindow({ webPreferences: { preload } });'
    - 'app.whenReady().then(createWindow);'
    - "app.on('second-instance', (event, argv) => { focusWindow(); });"
    - 'const token = safeStorage.decryptString(encrypted);'
sources:
  - https://www.electronjs.org/docs/latest/faq
  - https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app
  - https://www.electronjs.org/docs/latest/api/safe-storage
  - https://www.electronjs.org/docs/latest/tutorial/performance
---
- **Garbage-collected Tray**: `new Tray()` (or menus/notifications with handlers) held only in a local variable → the icon disappears or clicks stop working after GC. Fix: keep module-level references.
- **Blocking main**: `readFileSync`, `execSync`, CPU-heavy loops or sync IPC handlers in main → every window freezes (input, rendering). Fix: async APIs, `utilityProcess`, workers.
- **Trusted deep-link argv**: `second-instance` `commandLine`, `process.argv` or macOS `open-url` URLs used as file paths, `loadURL` targets or actions unparsed → one-click attacks from websites. Fix: strict URL parsing, allowlisted actions.
- **Missed launch URLs**: `open-url` registered after `await app.whenReady()` (macOS) or no `requestSingleInstanceLock()` (Windows/Linux) → the first link is lost or a second instance starts. Fix: register early; quit when the lock is not obtained.
- **Renderer crashes ignored**: no `render-process-gone`/`unresponsive` handling → a blank window forever. Fix: log, then reload or recreate the window.
- **Secrets at rest**: tokens in `localStorage`, `electron-store` JSON or plain files → readable by any process of the user. `safeStorage` used before `ready` or with Linux `basic_text` backend → weak or failed encryption. Fix: `safeStorage` after `ready`, check `getSelectedStorageBackend()`.
