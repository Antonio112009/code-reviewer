---
name: SwiftData models and contexts
description: SwiftData (iOS 17+) defects — models and contexts crossing actors, autosave only on mainContext, views without a model container, renames without originalName, unique-attribute upserts, CloudKit schema limits and the default nullify delete rule.
activation:
  content:
    - '@Model\b|\bModel(?:Context|Container|Actor)\b|@ModelActor\b|@Query\b|\bFetchDescriptor\b|#Predicate\b'
    - '@(?:Attribute|Relationship)\(|\bVersionedSchema\b|\bSchemaMigrationPlan\b|\bPersistentIdentifier\b|\.modelContainer\(|\bautosaveEnabled\b'
  examples:
    - '@Model final class Recipe { var title: String }'
    - '@Relationship(deleteRule: .cascade) var ingredients: [Ingredient]'
sources:
  - https://developer.apple.com/documentation/swiftdata/modelcontext
  - https://developer.apple.com/documentation/swiftdata/modelcontext/autosaveenabled
  - https://developer.apple.com/documentation/swiftdata/syncing-model-data-across-a-persons-devices
  - https://developer.apple.com/videos/play/wwdc2023/10195/
---
- **Crossing actors**: `@Model` instances and `ModelContext` aren't Sendable → passing them into `Task.detached` or another actor crashes or corrupts data. Fix: pass `persistentModelID` and refetch inside a `@ModelActor`.
- **Autosave only on mainContext**: contexts you create (`ModelContext(container)`, `@ModelActor`) have `autosaveEnabled = false` → changes are lost unless you call `save()`.
- **No container in the environment**: views without `.modelContainer(...)` above them (new windows, previews, hosting controllers) get an in-memory, schema-less context → inserts throw and fetches return nothing.
- **Renames lose data**: renaming a property or model without `@Attribute(originalName:)`/`@Relationship(originalName:)` drops the old column's data; changes lightweight migration can't handle need `VersionedSchema` plus a `SchemaMigrationPlan`.
- **Unique upserts**: inserting a model whose `@Attribute(.unique)` value already exists silently updates the existing record → accidental overwrites.
- **CloudKit limits**: with iCloud sync, `.unique`, non-optional relationships and the `.deny` delete rule aren't supported, and the production schema is additive-only.
- **Delete rules**: relationships default to `.nullify` → deleting a parent leaves orphaned children. Fix: `@Relationship(deleteRule: .cascade)` for owned data.
