---
name: SwiftPM manifests and package resources
description: Package.swift changes with non-obvious effects — swift-tools-version 6 switching every target to the Swift 6 language mode, unsafeFlags, branch/revision dependencies, 0.x version ranges — and package resources loaded through Bundle.main.
activation:
  files: ['Package.swift', 'Package@swift-*.swift']
  content: ['\bBundle\.module\b', '\bresources:\s*\[']
sources:
  - https://github.com/apple/swift-migration-guide/blob/main/Guide.docc/EnableDataRaceSafety.md
  - https://developer.apple.com/documentation/packagedescription/swiftsetting/unsafeflags(_:_:)
  - https://developer.apple.com/documentation/xcode/bundling-resources-with-a-swift-package
  - https://github.com/swiftlang/swift-package-manager/blob/main/Sources/Runtimes/PackageDescription/PackageRequirement.swift
---
- **Tools version flips the language mode**: raising `// swift-tools-version:` to 6.0+ puts every target in the Swift 6 language mode — strict concurrency errors plus runtime actor-isolation traps on wrong-thread callbacks. Fix: `swiftLanguageModes: [.v5]` or per-target `.swiftLanguageMode(.v5)` while migrating.
- **unsafeFlags**: `unsafeFlags([...])` makes the target's products ineligible for use by other packages → downstream resolution fails. Fix: keep it to root or local packages.
- **Branch or revision dependencies**: `.package(url:branch:)` or `revision:` in a published package → consumers depending on it by version fail to resolve ("depends on an unstable-version package"); builds aren't reproducible. Fix: tagged versions.
- **0.x ranges**: `from: "0.4.0"` means `0.4.0..<1.0.0`, so breaking 0.5.0 releases are picked up. Fix: `.upToNextMinor(from:)` for 0.x dependencies.
- **Package resources**: package code loading its own files via `Bundle.main` gets `nil` (they live in the module bundle) → force-unwrap crashes. Fix: `Bundle.module`; list files Xcode doesn't recognise in `resources:` (`.process` flattens folders, `.copy` keeps them).
