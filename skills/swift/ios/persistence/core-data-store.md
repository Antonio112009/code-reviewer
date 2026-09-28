---
name: Core Data stores, models and fetches
description: Core Data store and schema risks — fatalError or store deletion on load failure, model edits without a new version, CloudKit-incompatible models, predicates built by string interpolation, unbounded fetches with relationship faulting and fetched-results-controller section rules.
tags: [CWE-943]
activation:
  files: ['**/*.xcdatamodel/contents']
  content:
    - '\bloadPersistentStores\b|\bNSPersistent(?:Cloud\w*)?Container\b|\bNSPersistentStoreDescription\b|\bdestroyPersistentStore\b|\bNSStagedMigrationManager\b'
    - '\bNSFetchRequest\b|\bNSFetchedResultsController\b|\bNSPredicate\(format:|\bfetchBatchSize\b|\bsectionNameKeyPath\b'
  examples:
    - 'container.loadPersistentStores { description, error in }'
    - 'let predicate = NSPredicate(format: "name == %@", name)'
sources:
  - https://developer.apple.com/documentation/coredata/nspersistentstoredescription/shouldmigratestoreautomatically
  - https://developer.apple.com/documentation/coredata/creating-a-core-data-model-for-cloudkit
  - https://developer.apple.com/documentation/coredata/nsfetchrequest/fetchbatchsize
  - https://developer.apple.com/documentation/coredata/nsfetchedresultscontroller
---
- **fatalError on load**: the template's `fatalError` in `loadPersistentStores` → a failed migration or full disk becomes a crash loop at launch. Fix: report and recover.
- **Deleting the store on error**: destroying or removing the SQLite file when loading fails → silent loss of all user data.
- **Model edited in place**: changing attributes, types or entities in the current model version instead of adding a version → "incompatible model" load failures; changes lightweight migration can't infer need a mapping model or staged migration (iOS 17+).
- **CloudKit rules**: with `NSPersistentCloudKitContainer`, unique constraints, non-optional relationships, missing inverses and the Deny rule are unsupported, and the production schema is additive-only → sync breaks.
- **Interpolated predicates**: `NSPredicate(format: "name == '\(input)'")` → quotes crash the parser and alter the query. Fix: `%@` arguments and `%K` for key paths.
- **Unbounded fetches**: no predicate, `fetchLimit` or `fetchBatchSize` (0 = everything) and relationships faulted per row → memory spikes and N+1 fetches. Fix: batch size and `relationshipKeyPathsForPrefetching`.
- **FRC sections**: `sectionNameKeyPath` must match the first sort descriptor's ordering, and the fetch request must not change after init → wrong sections or crashes.
