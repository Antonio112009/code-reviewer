---
name: Data at rest and backups
description: On-device secret handling — plaintext tokens in prefs, DataStore, databases or external storage, the deprecated security-crypto library, Keystore keys invalidated or missing after restore, biometric prompts without CryptoObject, backup and device-transfer rules, clipboard and screen capture.
priority: 70
tags: [CWE-312, CWE-922, CWE-530, OWASP-A04]
activation:
  content:
    - '\b(?:EncryptedSharedPreferences|EncryptedFile|MasterKey|MasterKeys)\b'
    - '\b(?:KeyGenParameterSpec|KeyStore\.getInstance|AndroidKeyStore|KeyPermanentlyInvalidatedException)\b'
    - '\bBiometricPrompt\b'
    - '\bandroid:(?:allowBackup|fullBackupContent|dataExtractionRules)\b'
    - '<(?:cloud-backup|device-transfer|full-backup-content|data-extraction-rules)\b'
    - '\b(?:getExternalFilesDir|getExternalStorageDirectory|getExternalStoragePublicDirectory)\s*\('
    - '\b(?:setPrimaryClip|ClipData\.newPlainText)\s*\('
    - '\bFLAG_SECURE\b|\bsetContentCaptureEnabled\s*\('
    - '\bputString\s*\(\s*(?:"[^"\n]{0,30}|\w{0,30})(?:[Tt]oken|TOKEN|[Ss]ecret|SECRET|[Pp]assword|PASSWORD)'
sources:
  - https://developer.android.com/privacy-and-security/security-tips
  - https://developer.android.com/jetpack/androidx/releases/security
  - https://developer.android.com/privacy-and-security/risks/backup-best-practices
  - https://developer.android.com/about/versions/17/behavior-changes-17
---
- **Plaintext secrets**: tokens, passwords or PII in `SharedPreferences`, DataStore, Room or files — or anything on external storage → readable on rooted devices, from backups, or by other apps. Fix: internal storage, Keystore-encrypted values.
- **Deprecated security-crypto**: `EncryptedSharedPreferences`, `EncryptedFile`, `MasterKey` are deprecated since security-crypto 1.1.0 (2025). Fix: Android Keystore (or Tink) directly in new code.
- **Keys don't travel**: Keystore keys aren't backed up or transferred, but encrypted prefs/files are → decryption fails after restore on a new device (`AEADBadTagException`, crash loop). Fix: exclude encrypted data from backup; on failure wipe and re-login.
- **Invalidated keys**: keys with user authentication are invalidated when biometrics change → unhandled `KeyPermanentlyInvalidatedException`. Fix: catch it, delete and regenerate the key, re-authenticate.
- **UI-only biometrics**: `BiometricPrompt.authenticate(info)` without a `CryptoObject` just flips a callback → hooking bypasses it. Fix: unlock a Keystore key that requires authentication.
- **Backups**: `allowBackup` defaults to true; on Android 12+ `fullBackupContent` is ignored and rules come from `dataExtractionRules`; without `<device-transfer>` rules all data moves device-to-device even if `allowBackup="false"`. Fix: exclude tokens/keys in both sections.
- **Clipboard and screen**: OTPs/passwords copied without `ClipDescription.EXTRA_IS_SENSITIVE` show in the clipboard preview; sensitive screens without `FLAG_SECURE` leak via screenshots, recents and capture (targetSdk 37 ignores `setContentCaptureEnabled(false)`). Fix: set both.
