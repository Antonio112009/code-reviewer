---
name: Deep links and URL handling
description: Deep-link defects in React Native — cold-start links dropped, link parameters trusted for sensitive actions, secrets over hijackable custom schemes, over-exposed linking configs, opening untrusted URLs and canOpenURL/openURL platform traps.
priority: 70
tags: [CWE-939, CWE-601, CWE-20]
activation:
  content:
    - '\bLinking\.|\bgetInitialURL\b|\buse(?:Linking)?URL\b|expo-linking'
    - '\blinking\s*[:=]\s*\{|\bprefixes\s*:'
    - 'react-native-app-auth|expo-auth-session|\buseAuthRequest\b|\bopenAuthSessionAsync\b'
  examples:
    - 'const url = await Linking.getInitialURL();'
    - "const linking = { prefixes: ['myapp://'] };"
    - "import { useAuthRequest } from 'expo-auth-session';"
sources:
  - https://reactnative.dev/docs/linking
  - https://reactnative.dev/docs/security
  - https://reactnavigation.org/docs/deep-linking
---
- **Cold start dropped**: handling only `Linking.addEventListener('url')` (warm) or only `getInitialURL()` (cold) → links that launch the app, or arrive while it runs, are ignored. Fix: handle both, or rely on React Navigation `linking`.
- **Trusting link parameters**: deep-link params (`token`, `amount`, `userId`, `redirect`) that trigger logins, password resets, payments or account changes without confirmation and server-side checks → one-tap attacks from any site or app. Fix: treat as untrusted, confirm, validate on the server.
- **Secrets over custom schemes**: OAuth codes, magic-link or reset tokens delivered via `myapp://` → any app registering the scheme can receive them (iOS picks silently). Fix: universal/App Links; OAuth with PKCE (`react-native-app-auth`, `expo-auth-session`).
- **Over-exposed routes**: `linking.config` mapping internal, admin or debug screens, or screens assuming a signed-in user or required params → reachable by URL, crashes on missing data. Fix: map only public entry screens; guard auth.
- **Opening untrusted URLs**: `Linking.openURL(serverOrUserValue)` → arbitrary schemes (`tel:`, `sms:`, other apps' schemes) launched from content. Fix: allowlist schemes and hosts.
- **canOpenURL/openURL traps**: `canOpenURL` returns false unless schemes are declared in `LSApplicationQueriesSchemes` (iOS) or `<queries>` (Android 11+); `openURL` rejects when nothing can handle the URL → wrong fallbacks, unhandled rejections. Fix: declare schemes, catch `openURL`.
