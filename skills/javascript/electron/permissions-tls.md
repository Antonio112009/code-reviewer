---
name: Permissions, devices and TLS
description: Electron session defects — permission requests granted by default, handlers that check the wrong origin, auto-selected USB/HID/serial/Bluetooth devices, silent screen capture and certificate-validation bypasses.
priority: 74
tags: [CWE-295, CWE-862, CWE-250]
activation:
  content:
    - '\bset(?:Permission(?:Request|Check)|DevicePermission|DisplayMediaRequest)Handler\b'
    - 'select-(?:hid-device|usb-device|serial-port|bluetooth-device)|select-client-certificate'
    - 'certificate-error|ignore-certificate-errors|\bsetCertificateVerifyProc\b'
sources:
  - https://www.electronjs.org/docs/latest/tutorial/security
  - https://www.electronjs.org/docs/latest/api/session
  - https://www.electronjs.org/docs/latest/api/app
---
- **Default-grant permissions**: no `session.setPermissionRequestHandler` → Electron approves every request (camera, microphone, geolocation, notifications, clipboard, `openExternal`) from any loaded page. Fix: deny by default; allow per permission and origin.
- **Checking the wrong origin**: handlers allowing by permission name only, or by `webContents.getURL()` instead of `details.requestingUrl`/`securityOrigin` → third-party iframes inherit access. Fix: check the requesting frame's origin and `isMainFrame`.
- **Auto-selected devices**: `select-hid-device`, `select-usb-device`, `select-serial-port` or `select-bluetooth-device` handlers calling back with the first device → any page gets hardware access without a user choice. Fix: show a chooser; restrict origins.
- **Silent screen capture**: `setDisplayMediaRequestHandler` granting a screen or window source without asking → pages record the screen invisibly. Fix: explicit user confirmation.
- **TLS bypass**: `certificate-error` handlers calling `callback(true)` (often "for dev"), `appendSwitch('ignore-certificate-errors')` or `setCertificateVerifyProc` returning `0` (also skips Certificate Transparency) → MITM of all traffic. Fix: `callback(false)`; return `-3` to defer to Chromium.
- **Client certificate auto-pick**: no `select-client-certificate` handler (Electron then uses the first certificate in the store) or one returning `list[0]` for any host → the user's identity certificate goes to arbitrary sites. Fix: `preventDefault`, match the host, ask the user.
