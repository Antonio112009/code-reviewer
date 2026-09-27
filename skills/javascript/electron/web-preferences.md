---
name: BrowserWindow security settings
description: Electron webPreferences and switches that turn renderer bugs into code execution — nodeIntegration, disabled contextIsolation or sandbox, webSecurity and insecure-content flags, the <webview> tag and privileged windows that load remote content.
priority: 76
tags: [CWE-94, CWE-693, OWASP-A02]
activation:
  content:
    - '\bwebPreferences\b|\bnodeIntegration\w*|\bcontextIsolation\b|\bsandbox\s*:'
    - '\b(?:webSecurity|allowRunningInsecureContent|experimentalFeatures|enableBlinkFeatures|webviewTag)\b'
    - 'appendSwitch\(\s*[''"](?:no-sandbox|disable-web-security|disable-site-isolation-trials|ignore-certificate-errors)'
sources:
  - https://www.electronjs.org/docs/latest/tutorial/security
  - https://www.electronjs.org/docs/latest/tutorial/sandbox
  - https://www.electronjs.org/docs/latest/tutorial/context-isolation
---
- **Node in renderers**: `nodeIntegration: true` (or `nodeIntegrationInSubFrames`/`nodeIntegrationInWorker`) → any XSS, injected frame or loaded remote page gets `require('child_process')` = RCE; it also disables the sandbox. Fix: keep false, expose narrow preload APIs.
- **Isolation off**: `contextIsolation: false` → page scripts reach preload globals and Electron APIs and can tamper with their prototypes. Fix: `true` (default since 12).
- **Sandbox off**: `sandbox: false`, usually added because the preload `require`s `fs`/`path` (sandboxed preloads only get `contextBridge`, `ipcRenderer`, `webFrame`, `webUtils`, `events`, `timers`, `url`) → a compromised renderer escapes more easily. Fix: move Node work to main via IPC; `app.enableSandbox()`.
- **Browser protections off**: `webSecurity: false`, `allowRunningInsecureContent`, `experimentalFeatures`, `enableBlinkFeatures`, or switches `no-sandbox`/`disable-web-security` → same-origin policy, mixed-content blocking or sandbox disabled app-wide. Fix: remove; solve CORS in main.
- **`<webview>` tag**: `webviewTag: true` without a `will-attach-webview` handler that strips `preload` and forces `nodeIntegration: false` → injected `<webview>` elements get Node. Fix: prefer `WebContentsView`; validate attach params.
- **Remote content in privileged windows**: windows whose preload exposes powerful APIs loading remote or user-supplied URLs → remote code reaches the bridge. Fix: separate unprivileged windows/sessions for remote content.
