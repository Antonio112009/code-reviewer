---
name: WebView bridge security
description: react-native-webview defects — privileged onMessage bridges reachable by untrusted pages, open navigation and OS scheme hand-off, script injection via injectJavaScript, file-URL access and weakened defaults.
priority: 72
tags: [CWE-749, CWE-79, CWE-940]
activation:
  content:
    - 'react-native-webview|<WebView\b'
    - '\b(?:injectJavaScript|injectedJavaScript\w*|onShouldStartLoadWithRequest|originWhitelist)\b'
    - '\ballow(?:FileAccess\w*|UniversalAccessFromFileURLs|ingReadAccessToURL)\b'
  examples:
    - "<WebView source={{ uri }} originWhitelist={['*']} />"
    - '<WebView source={{ uri }} allowFileAccess allowUniversalAccessFromFileURLs />'
sources:
  - https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md
  - https://github.com/react-native-webview/react-native-webview/blob/master/docs/Guide.md
---
- **Bridge open to any page**: `onMessage` triggering native actions (payments, tokens, files) without checking `event.nativeEvent.url`, or tokens injected into pages that can navigate anywhere → any loaded page or iframe drives the app or steals them. Fix: origin allowlist, payload schema.
- **Unrestricted navigation**: `originWhitelist={['*']}` (needed for inline `html`) with remote or user URLs and no `onShouldStartLoadWithRequest` → attacker pages load in the bridged WebView; Android doesn't call it for the initial load. Fix: also validate `source.uri`.
- **Scheme hand-off**: URLs outside `originWhitelist` (`tel:`, `sms:`, `intent:`, custom schemes) go to the OS → untrusted pages launch dialers or other apps. Fix: allowlist in `onShouldStartLoadWithRequest`.
- **Script injection**: `injectJavaScript`/`injectedJavaScript` built with template literals from data → code injection. Fix: `postMessage` or embed `JSON.stringify(data)`.
- **File access**: `allowFileAccess`, `allowFileAccessFromFileURLs`, `allowUniversalAccessFromFileURLs` or broad `allowingReadAccessToURL` with untrusted content → local file theft. Fix: keep defaults (false).
- **Weakened defaults**: `mixedContentMode="always"`, `setSupportMultipleWindows={false}` (lets iframes take over the top frame), `javaScriptCanOpenWindowsAutomatically`, `webviewDebuggingEnabled` in release → MITM, phishing, inspectable app. Fix: defaults; debugging only in `__DEV__`.
