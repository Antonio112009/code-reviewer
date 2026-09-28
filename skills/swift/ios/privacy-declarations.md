---
name: Privacy usage strings and manifests
description: Crashes and App Store rejections from privacy declarations — protected resources used without NS…UsageDescription, required-reason APIs missing from PrivacyInfo.xcprivacy, invalid manifests and tracking before ATT authorization.
activation:
  files: ['PrivacyInfo.xcprivacy']
  content:
    - '\b(?:AVCaptureDevice|AVAudioSession|AVAudioApplication|PHPhotoLibrary|CLLocationManager|CNContactStore|EKEventStore|CBCentralManager|CBPeripheralManager|HKHealthStore|CMMotionActivityManager|SFSpeechRecognizer|LAContext|ATTrackingManager|ASIdentifierManager)\b'
    - '\b(?:UserDefaults|systemUptime|mach_absolute_time|creationDate|modificationDate|volumeAvailableCapacity\w*|activeInputModes)\b'
    - '<key>(?:NS\w+UsageDescription|NSPrivacy\w+)</key>'
  examples:
    - 'let manager = CLLocationManager()'
    - 'let defaults = UserDefaults.standard'
    - '<key>NSCameraUsageDescription</key>'
sources:
  - https://developer.apple.com/documentation/avfoundation/requesting-authorization-to-capture-and-save-media
  - https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api
  - https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
  - https://developer.apple.com/documentation/adsupport/asidentifiermanager/advertisingidentifier
---
- **Missing usage description**: using the camera, microphone, photos, location, contacts, calendars, Bluetooth, motion or health data without the matching `NS…UsageDescription` in that target's Info.plist → the system terminates the app on first access.
- **Required-reason APIs**: new uses of `UserDefaults`, file timestamps (`creationDate`, `modificationDate`, `stat`), `systemUptime`/`mach_absolute_time`, disk-space keys or `activeInputModes` without an `NSPrivacyAccessedAPITypes` entry and reason code in the bundle's `PrivacyInfo.xcprivacy` → App Store Connect rejects the upload (since May 2024).
- **Frameworks need their own manifest**: an SDK or framework target can't rely on the app's manifest for its required-reason API use.
- **Invalid manifest**: unexpected keys or values in `PrivacyInfo.xcprivacy` → submissions rejected.
- **Tracking without ATT**: reading `advertisingIdentifier` before `ATTrackingManager` authorization returns zeros; domains in `NSPrivacyTrackingDomains` fail to load until the user allows tracking; `NSUserTrackingUsageDescription` is required.
