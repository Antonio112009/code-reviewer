---
name: Auto-update
description: Electron update defects — electron-updater Windows signature bypass (CVE-2024-39698), HTTP or user-configurable feeds, unverified Linux packages, tokens embedded for private feeds, downgrades and forced restarts without error handling.
priority: 72
tags: [CWE-494, CWE-347, CWE-798]
activation:
  content:
    - 'electron-updater|update-electron-app|\bautoUpdater\b'
    - '\b(?:setFeedURL|quitAndInstall|checkForUpdates(?:AndNotify)?)\('
    - '\b(?:allowDowngrade|allowUnverifiedLinuxPackages|disableWebInstaller|verifyUpdateCodeSignature)\b'
  examples:
    - "const { autoUpdater } = require('electron-updater');"
    - 'autoUpdater.checkForUpdatesAndNotify();'
    - 'autoUpdater.allowDowngrade = true;'
sources:
  - https://www.electron.build/docs/features/auto-update/
  - https://github.com/electron-userland/electron-builder/security/advisories/GHSA-9jxc-qjr9-vjxq
  - https://www.electronjs.org/docs/latest/api/auto-updater
---
- **Bypassable Windows verification**: `electron-updater` ≤ 6.3.0-alpha.5 (CVE-2024-39698), disabled `verifyUpdateCodeSignature` or unsigned builds → a tampered feed installs code with an invalid signature. Fix: upgrade, sign builds, keep verification on.
- **Insecure feed**: `setFeedURL`/`publish` with `http://`, or update URLs from settings, env or remote config → MITM or attacker servers deliver updates. Fix: HTTPS with a fixed provider.
- **Unverified Linux packages**: `allowUnverifiedLinuxPackages` defaults to `true` → `.deb`/`.rpm` updates installed without GPG verification. Fix: `false` plus signed packages.
- **Tokens in the app**: private GitHub provider with a `GH_TOKEN`/`token` baked into the build → extractable repository credentials. Fix: public release feed or an authenticated proxy.
- **Downgrades**: `allowDowngrade: true` → a compromised or mis-set channel rolls users back to vulnerable versions. Fix: keep it off except deliberate channel switches.
- **Errors and restarts**: no `autoUpdater.on('error')` → unhandled rejections on network failures; `quitAndInstall()` straight from `update-downloaded` → unsaved work lost. Fix: handle errors; prompt, or install on quit.
