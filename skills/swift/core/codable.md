---
name: Codable and JSON decoding
description: JSONDecoder/JSONEncoder pitfalls — swallowed decode errors, one bad field failing a whole payload, default date strategies, snake-case conversion with acronyms, lossy Decimal before iOS 17, subclass fields never coded, JSONSerialization NSNull and non-finite floats.
activation:
  content:
    - '\b(?:Codable|Decodable|Encodable|JSONDecoder|JSONEncoder|PropertyList(?:De|En)coder|CodingKeys?|JSONSerialization|DecodingError)\b'
    - '\b(?:date|key|data|nonConformingFloat)(?:De|En)codingStrategy\b|\binit\(from\s+decoder\b|\bfunc\s+encode\(to\b|\bdecodeIfPresent\('
  examples:
    - 'struct User: Codable { let id: UUID; let name: String }'
    - 'decoder.dateDecodingStrategy = .iso8601'
sources:
  - https://developer.apple.com/documentation/foundation/jsondecoder
  - https://developer.apple.com/documentation/foundation/jsondecoder/keydecodingstrategy-swift.enum/convertfromsnakecase
  - https://developer.apple.com/documentation/foundation/encoding-and-decoding-custom-types
  - https://github.com/davdroman/PreciseDecimal
---
- **Swallowed errors**: `try? decoder.decode(...)` turns schema drift into empty screens with no log. Fix: `do/catch`, log the `DecodingError` path.
- **One bad field fails everything**: a missing or `null` non-optional property, or an unknown enum raw value, fails the whole payload — every element of an array. Fix: optionals/defaults, an `unknown` fallback in `init(from:)`, lossy element decoding.
- **Date strategy**: default `.deferredToDate` reads numbers as seconds since 2001, not 1970 (31 years off); `.iso8601` rejects fractional seconds before Swift 6.2 Foundation (iOS 26); `.secondsSince1970` with millisecond values gives far-future dates. Fix: explicit strategy.
- **Snake-case conversion**: `.convertFromSnakeCase` yields `userId`, never `userID`, and converts JSON keys before matching, so snake_case `CodingKeys` raw values never match → silently missing fields. Fix: explicit `CodingKeys` without the strategy.
- **Decimal precision**: before iOS 17/macOS 14, `JSONDecoder` parsed `Decimal` through `Double` → money values drift. Fix: amounts as strings or integer minor units.
- **Subclass fields dropped**: a subclass of a `Codable` class inherits `init(from:)`/`encode(to:)`, so its own stored properties are never coded. Fix: override both and call `super`.
- **Untyped JSON**: `JSONSerialization` yields `NSNull` for `null` and `NSNumber` for numbers and bools → `as! String` crashes; `JSONEncoder` throws on `.nan`/`.infinity` unless a non-conforming float strategy is set.
