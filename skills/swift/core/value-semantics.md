---
name: Value semantics and equality
description: Lost writes to copies of value types, shared class references inside structs, Hashable and Equatable implementations that disagree, mutated hash keys, and NSObject subclasses whose Swift == is ignored by collections.
activation:
  content:
    - '\b(?:if|guard|for|while)\s+var\b|\bvar\s+\w+\s*=\s*\w+(?:\.\w+)?\[[^\]\n]{1,40}\]\s*$'
    - '\bstatic\s+func\s*==|\bfunc\s+hash\(into|\boverride\s+(?:func\s+isEqual|var\s+hash)\b|\b(?:Hashable|Equatable)\b'
    - '\bisKnownUniquelyReferenced\b|:\s*NSObject\b'
sources:
  - https://developer.apple.com/documentation/swift/hashable
  - https://developer.apple.com/documentation/objectivec/nsobjectprotocol/isequal(_:)
  - https://docs.swift.org/swift-book/documentation/the-swift-programming-language/classesandstructures/
---
- **Lost write-back**: mutating a copy (`var item = items[i]`, `if var`, `for var x in list`, `var v = dict[key]`) without writing it back → the change is silently lost. Fix: mutate in place, e.g. `items[i].count += 1`.
- **Class inside a struct**: a struct holding class instances shares them across copies → "copies" mutate the original, also across threads. Fix: value types throughout, or copy-on-write with `isKnownUniquelyReferenced`.
- **Hashable disagrees with ==**: custom `==` comparing a subset (e.g. `id`) while `hash(into:)` is synthesized from all stored properties, or the reverse → `Set` duplicates, failed `Dictionary` lookups, diffable data-source crashes. Fix: hash exactly what `==` compares.
- **Mutated keys**: changing hashed properties of a class instance already used as a `Set` element or `Dictionary` key → the entry becomes unreachable. Fix: hash only immutable identity.
- **NSObject equality**: for `NSObject` subclasses, `Set`, `contains`, `firstIndex(of:)` and diffable snapshots call `isEqual(_:)`/`hash`, ignoring a Swift `static func ==` in the subclass. Fix: override `isEqual(_:)` and `hash` together.
