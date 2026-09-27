---
name: Face ID and Touch ID
description: LocalAuthentication misuse — biometric success used as a bypassable boolean gate, access surviving enrollment changes, missing NSFaceIDUsageDescription, reply handlers on a private queue and lockout without fallback.
tags: [CWE-287, CWE-603]
activation:
  content: ['\bLAContext\b|\b(?:evaluate|canEvaluate)Policy\b|\bLAPolicy\b|\bbiometry\w*|\bSecAccessControlCreateWithFlags\b|\.userPresence\b|\bevaluatedPolicyDomainState\b']
sources:
  - https://developer.apple.com/documentation/localauthentication/accessing-keychain-items-with-face-id-or-touch-id
  - https://developer.apple.com/documentation/localauthentication/logging-a-user-into-your-app-with-face-id-or-touch-id
  - https://developer.apple.com/documentation/localauthentication/lacontext/evaluatepolicy(_:localizedreason:reply:)
  - https://developer.apple.com/documentation/localauthentication/lacontext/evaluatedpolicydomainstate
---
- **Boolean gate**: `evaluatePolicy` success used alone to unlock stored tokens or sessions → hooking the call on a jailbroken or instrumented device bypasses it; nothing is cryptographically bound. Fix: keep the secret in the Keychain behind a `SecAccessControl` (`.biometryCurrentSet`/`.userPresence`).
- **Enrollment changes**: `.biometryAny` or a plain `LAContext` check keeps working after a new face or fingerprint is enrolled → whoever enrolls gains access. Fix: `.biometryCurrentSet`, or compare `evaluatedPolicyDomainState`.
- **Missing NSFaceIDUsageDescription**: without the key the system refuses Face ID → biometric login silently fails on Face ID devices.
- **Reply queue**: the `evaluatePolicy` reply runs on a private queue → UI updates off-main; calling `canEvaluatePolicy` inside the reply can deadlock. Fix: hop to main or use the async API on the main actor.
- **No fallback**: `.deviceOwnerAuthenticationWithBiometrics` has no passcode fallback → users locked out after `biometryLockout` or unenrollment. Fix: handle the error or use `.deviceOwnerAuthentication`.
