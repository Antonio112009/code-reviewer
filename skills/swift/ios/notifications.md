---
name: Push and local notifications
description: UserNotifications and APNs integration — delegate assigned after launch, device tokens stringified or cached, completion handlers not called in delegate, silent-push and service-extension callbacks within their time limits.
activation:
  content:
    - '\bUN(?:UserNotificationCenter\w*|Notification\w*)\b|\bregisterForRemoteNotifications\b|\bdeviceToken\b'
    - '\bdidReceiveRemoteNotification\b|\bfetchCompletionHandler\b|\bcontentHandler\b|\bserviceExtensionTimeWillExpire\b|\bwillPresent\b'
sources:
  - https://developer.apple.com/documentation/usernotifications/unusernotificationcenterdelegate
  - https://developer.apple.com/documentation/uikit/uiapplicationdelegate/application(_:didregisterforremotenotificationswithdevicetoken:)
  - https://developer.apple.com/documentation/uikit/uiapplicationdelegate/application(_:didreceiveremotenotification:fetchcompletionhandler:)
  - https://developer.apple.com/documentation/usernotifications/unnotificationserviceextension/didreceive(_:withcontenthandler:)
---
- **Delegate set too late**: `UNUserNotificationCenter.current().delegate` assigned after launch finishes (in a view, after login) → the tap that launched the app and early notifications are missed. Fix: set it in `willFinishLaunching`/`didFinishLaunching` (SwiftUI: `UIApplicationDelegateAdaptor`).
- **Token encoding**: turning `deviceToken` into text with `String(data:encoding:)`, `description` or interpolation (Swift prints "32 bytes"; iOS 13 changed `NSData`'s format) → invalid tokens. Fix: hex-encode the bytes.
- **Cached tokens**: skipping registration or upload because a token is stored locally → stale tokens after restore or reinstall. Fix: register each launch and send the current token.
- **Delegate completion**: `userNotificationCenter(_:didReceive:withCompletionHandler:)` and `willPresent` must call their completion handler on every path (or return from the async variant) → actions never complete, foreground banners never show.
- **Silent push deadline**: `didReceiveRemoteNotification(_:fetchCompletionHandler:)` must call the handler within 30 s on every path → otherwise the app is terminated and future wakes throttled.
- **Service extension deadline**: `didReceive(_:withContentHandler:)` must call `contentHandler` within ~30 s, and `serviceExtensionTimeWillExpire()` must deliver fallback content → otherwise the original, possibly encrypted payload is shown.
