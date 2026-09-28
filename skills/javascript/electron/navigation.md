---
name: Navigation, popups and external links
description: Electron navigation defects — privileged windows navigable to attacker pages, permissive setWindowOpenHandler or legacy new-window listeners, shell.openExternal/openPath with untrusted input and remote content loaded over HTTP.
priority: 76
tags: [CWE-601, CWE-78, CWE-829]
activation:
  content:
    - 'will-(?:frame-)?navigate|will-redirect|\bsetWindowOpenHandler\b|[''"]new-window[''"]'
    - '\bshell\.(?:openExternal|openPath|showItemInFolder)\b'
    - '\bloadURL\('
  examples:
    - "win.webContents.setWindowOpenHandler(({ url }) => ({ action: 'deny' }));"
    - 'shell.openExternal(url);'
    - "mainWindow.loadURL('https://example.com');"
sources:
  - https://www.electronjs.org/docs/latest/tutorial/security
  - https://www.electronjs.org/docs/latest/api/web-contents
  - https://www.electronjs.org/docs/latest/api/window-open
  - https://www.electronjs.org/docs/latest/api/shell
---
- **No navigation guard**: no `will-navigate`/`will-frame-navigate` handler, or allowing by substring/`startsWith` → links, redirects or injected script take the privileged window (and preload) to attacker pages. Fix: `preventDefault` unless `new URL(url).origin` is allowlisted (they don't fire for `loadURL`).
- **Open popups**: `setWindowOpenHandler` returning `{ action: 'allow' }` for any URL, or no handler → untrusted pages open Electron windows with inherited preferences; legacy `'new-window'` listeners never fire (removed in 22) → no protection. Fix: deny by default.
- **openExternal with untrusted URLs**: URLs from `window.open`, links, IPC or remote data passed to `shell.openExternal` → `file:`, `smb:` or custom schemes launch local programs (RCE). Fix: parse; allow only `https:`/`mailto:` and known hosts.
- **openPath on renderer paths**: `shell.openPath`/`showItemInFolder` with renderer-supplied paths → executes downloaded or planted files. Fix: only app-created, non-executable files.
- **Remote UI over HTTP**: `loadURL('http://…')` or user-configurable URLs in windows with a preload → MITM or injected content reaches the bridge. Fix: HTTPS; bundle the UI and serve it via a custom protocol.
