---
name: Secure storage on device
description: Credential and PII storage defects in React Native — tokens in AsyncStorage/MMKV/persisted stores, secrets bundled via .env, keychain data surviving reinstall, biometric-bound items invalidated, JS-only biometric gates and invalid SecureStore keys.
priority: 72
tags: [CWE-312, CWE-922, CWE-798]
activation:
  content:
    - '\b(?:AsyncStorage|SecureStore|Keychain|EncryptedStorage|LocalAuthentication)\b'
    - '\b(?:MMKV|createMMKV|persistReducer|persistStore|createJSONStorage)\b'
    - 'react-native-(?:keychain|config|mmkv|biometrics)|expo-(?:secure-store|local-authentication)'
    - '\b(?:setItem|setItemAsync|setGenericPassword)\('
sources:
  - https://reactnative.dev/docs/security
  - https://docs.expo.dev/versions/latest/sdk/securestore/
---
- **Tokens in plain storage**: tokens, passwords or PII in `AsyncStorage`, unencrypted MMKV or a store persisted whole (`redux-persist`) → readable from backups and rooted devices. Fix: Keychain/Keystore via `expo-secure-store`/`react-native-keychain`; exclude auth slices from persistence.
- **Secrets in the bundle**: API secrets from `react-native-config`, `.env` or constants → inlined into the binary, extractable by anyone. Fix: keep secrets on a backend; ship only public identifiers.
- **Keychain outlives uninstall**: iOS keeps SecureStore/Keychain items after reinstall while AsyncStorage is wiped → a previous user's session resurrects. Fix: on first launch (AsyncStorage flag) delete keychain items.
- **Biometric-bound items**: values saved with `requireAuthentication` become unreadable after biometric enrollment changes → reads throw or return null; app crashes or silently logs out. Fix: catch, delete, re-authenticate.
- **JS-only biometric gate**: `authenticateAsync()` success used as the only lock over data readable without it → bypassable by hooking on rooted devices. Fix: OS-enforced access control (`requireAuthentication`, keychain access control).
- **Invalid SecureStore usage**: keys with `:`, `@`, `/` or spaces throw (only alphanumerics, `.`, `-`, `_`); large JSON values may be rejected on iOS; no web support. Fix: sanitize keys, store small secrets, branch on `Platform.OS`.
