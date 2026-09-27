---
name: Preload and contextBridge
description: Preload bridge defects — generic IPC passthroughs, leaked IpcRendererEvent objects, listeners without unsubscribe, Node/shell power exposed to the page, window globals under context isolation and contextBridge copy semantics.
priority: 76
tags: [CWE-749, CWE-94]
activation:
  content:
    - '\b(?:contextBridge|exposeInMainWorld|exposeInIsolatedWorld|ipcRenderer|webUtils)\b'
  files: ['**/preload*.{js,cjs,mjs,ts,mts,cts}', '**/preload/**']
sources:
  - https://www.electronjs.org/docs/latest/api/context-bridge
  - https://www.electronjs.org/docs/latest/api/ipc-renderer
  - https://www.electronjs.org/docs/latest/tutorial/ipc
  - https://www.electronjs.org/docs/latest/tutorial/security
---
- **Generic IPC passthrough**: exposing `ipcRenderer` itself (it arrives empty since Electron 29) or wrappers like `send: (ch, ...a) => ipcRenderer.send(ch, ...a)`/`invoke(channel, …)` → any page script can call every main-process handler. Fix: one function per action with fixed channel names.
- **Event object leaked**: `on: (ch, cb) => ipcRenderer.on(ch, cb)` hands page code the `IpcRendererEvent` (with `sender`) → full IPC access. Fix: `ipcRenderer.on(CH, (_e, ...args) => cb(...args))` on a fixed channel.
- **No unsubscribe**: exposed `onUpdate(cb)` that never returns a remover → listeners pile up on every component mount: duplicate handling, leaks. Fix: return `() => ipcRenderer.removeListener(CH, handler)`.
- **Powers in the bridge**: exposing `fs`, `child_process`, `shell.openExternal`, `require`, or functions taking arbitrary paths, URLs or commands → XSS becomes file access or RCE. Fix: intent-level APIs validated in main.
- **Globals instead of bridge**: `window.api = …` in a context-isolated preload → invisible to the page (different world); it "works" only if isolation is disabled. Fix: `contextBridge.exposeInMainWorld`.
- **Copy semantics**: bridged values are copies — mutations don't propagate, class prototypes and methods are dropped, Symbols vanish, Errors lose custom fields → broken `instanceof` and method calls. Fix: plain data; functions as separate members.
