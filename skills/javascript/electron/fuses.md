---
name: Fuses and package integrity
description: Electron packaging defects — default-on fuses letting anyone run Node under the app's identity, missing ASAR integrity (and the CVE-2025-55305 bypass), fork breaking when RunAsNode is off, cookie-encryption fuse toggling and DevTools in production.
priority: 70
tags: [CWE-94, CWE-353, CWE-489]
activation:
  content:
    - '@electron/fuses|\bFuseV1Options\b|\bflipFuses\b|\bFusesPlugin\b'
    - '\bELECTRON_RUN_AS_NODE\b|\bchild_process\.fork\b|\bopenDevTools\('
    - '\basar(?:Unpack)?\s*:|\bcookieEncryption\b'
  examples:
    - "import { flipFuses, FuseV1Options } from '@electron/fuses';"
    - 'mainWindow.webContents.openDevTools();'
    - "asarUnpack: ['**/*.node'],"
  files: ['**/forge.config.{js,cjs,mjs,ts}', '**/electron-builder.config.{js,cjs,mjs,ts}']
sources:
  - https://www.electronjs.org/docs/latest/tutorial/fuses
  - https://github.com/electron/electron/security/advisories/GHSA-vmqv-hx8q-j7mg
  - https://www.electronjs.org/docs/latest/api/utility-process
---
- **Default-on fuses**: packaging without flipping `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and `EnableNodeCliInspectArguments` → anyone who can launch the binary runs arbitrary Node code under its signature and entitlements (`ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `--inspect`). Fix: flip them with `@electron/fuses`.
- **No code integrity**: `EnableEmbeddedAsarIntegrityValidation` + `OnlyLoadAppFromAsar` off → a modified `app.asar` or a planted `app/` folder loads silently (macOS/Windows). With them on, Electron < 35.7.5 / 36.8.1 / 37.3.1 is bypassable (CVE-2025-55305). Fix: enable both, upgrade.
- **fork breaks with RunAsNode off**: `child_process.fork` of app scripts relies on `ELECTRON_RUN_AS_NODE` → throws once the fuse is flipped. Fix: `utilityProcess.fork`.
- **Unneeded file privileges**: `GrantFileProtocolExtraPrivileges` left on although the UI is served via a custom protocol → `file://` pages keep extra powers. Fix: flip it off.
- **Cookie encryption toggled**: `EnableCookieEncryption` turned on, then off in a later release → the existing cookie store becomes unusable (mass logouts). Fix: treat it as one-way.
- **DevTools in production**: `openDevTools()` or DevTools shortcuts not gated by `!app.isPackaged` → users get a console with the preload bridge. Fix: dev-only.
