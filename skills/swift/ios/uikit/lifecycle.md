---
name: UIKit app lifecycle and presentation
description: Scene-era lifecycle traps — the UIScene life cycle required with the iOS 27 SDK, app-delegate callbacks that stop firing, cold-start URLs, global window lookups — plus presentation crashes and missed callbacks for sheets and iPad popovers.
activation:
  content:
    - '\bUI(?:Application|Scene|WindowScene)Delegate\b|\bapplication(?:DidBecomeActive|WillResignActive|DidEnterBackground|WillEnterForeground)\b|\bwillConnectTo\b|\bopenURLContexts\b'
    - '\bUIApplicationSceneManifest\b|\.(?:keyWindow|windows)\b|\bconnectionOptions\b'
    - '\bpresent\([^)\n]{1,80}\banimated:|\bUIAlertController\b|\bUIActivityViewController\b|\bpopoverPresentationController\b|\bmodalPresentationStyle\b|\bviewWillAppear\b|\bpresentationControllerDidDismiss\b'
sources:
  - https://developer.apple.com/documentation/technotes/tn3187-migrating-to-the-uikit-scene-based-life-cycle
  - https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app
  - https://developer.apple.com/documentation/uikit/uimodalpresentationstyle/automatic
  - https://developer.apple.com/documentation/uikit/uiactivityviewcontroller
---
- **Scene life cycle required**: UIKit apps built with the iOS 27 SDK must adopt scenes (`UIApplicationSceneManifest` plus a scene delegate) or they fail to launch.
- **App-delegate callbacks go silent**: once scenes are adopted, `applicationDidBecomeActive`, `WillResignActive`, `DidEnterBackground` and `WillEnterForeground` aren't called → saving, locking or pausing logic there stops running. Fix: scene delegate methods or `UIScene` notifications.
- **Cold-start links**: with scenes, `application(_:open:options:)` isn't used; URLs and universal links that launch the app arrive only in `scene(_:willConnectTo:options:)` connection options, later ones in `scene(_:openURLContexts:)`/`scene(_:continue:)`. Fix: handle both paths.
- **Global window lookups**: `UIApplication.shared.windows.first` or `keyWindow` in multi-window or iPad apps → wrong window or `nil`. Fix: use the view's `window`/`windowScene`.
- **iPad popovers**: presenting an `.actionSheet` `UIAlertController` or `UIActivityViewController` on iPad without `popoverPresentationController.sourceView`/`sourceItem` → crash.
- **Sheet callbacks**: the default style is a sheet (`.pageSheet`, `.formSheet` from iOS 18), so the presenter's `viewWillAppear` doesn't run on dismissal and users can swipe it away; `presentationControllerDidDismiss` skips programmatic dismissals. Fix: explicit callbacks, `isModalInPresentation` for unsaved edits.
- **Presenting off-screen**: presenting from a controller not in the window hierarchy, or while another presentation is running → silently ignored. Fix: present from the top-most visible controller after the transition.
