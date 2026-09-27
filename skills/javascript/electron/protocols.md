---
name: Custom protocols and file access
description: Electron protocol defects — path traversal in protocol.handle file servers, UI served from file:// with extra privileges, over-privileged schemes, deprecated register*Protocol APIs and net.fetch of renderer-chosen URLs.
priority: 72
tags: [CWE-22, CWE-918]
activation:
  content:
    - '\bprotocol\.(?:handle|register\w*|intercept\w*|unhandle)\('
    - '\bregisterSchemesAsPrivileged\b|\bnet\.fetch\(|\bpathToFileURL\b'
    - '[''"]file://|\bloadFile\(|\bGrantFileProtocolExtraPrivileges\b'
sources:
  - https://www.electronjs.org/docs/latest/api/protocol
  - https://www.electronjs.org/docs/latest/tutorial/security
  - https://www.electronjs.org/docs/latest/tutorial/fuses
  - https://www.electronjs.org/docs/latest/breaking-changes
---
- **Traversal in handlers**: `protocol.handle('app', req => net.fetch('file://' + root + new URL(req.url).pathname))` without resolving and checking the path stays under `root` → `app://x/../../` or `%2e%2e` reads arbitrary files. Fix: `path.resolve` + `path.relative` check, then `pathToFileURL`.
- **UI from file://**: `loadFile`/`file://` pages with the `GrantFileProtocolExtraPrivileges` fuse on → an XSS can fetch any local file and frame local pages. Fix: serve via a custom `protocol.handle` scheme; flip the fuse off.
- **Over-privileged schemes**: `registerSchemesAsPrivileged` with `bypassCSP`, `corsEnabled` or `allowServiceWorkers` that aren't needed → CSP disabled for app pages, cross-origin reads. It must run once, before `ready` → a second call elsewhere is lost. Fix: minimal privileges, one registration.
- **Deprecated protocol APIs**: `registerFileProtocol`/`registerBufferProtocol`/`intercept*Protocol` (deprecated since 25; Windows file-path URLs stopped working in 33) → broken asset loading on upgrade. Fix: `protocol.handle`.
- **net.fetch of renderer URLs**: main process fetching renderer-provided URLs via `net.fetch`/`session.fetch` → requests carry the app session's cookies and reach internal hosts. Fix: allowlist hosts and schemes.
