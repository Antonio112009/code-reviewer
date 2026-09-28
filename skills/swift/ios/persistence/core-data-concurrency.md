---
name: Core Data contexts and threading
description: Core Data concurrency and consistency bugs — managed objects crossing queues, temporary object IDs, contexts that never merge, the default NSErrorMergePolicy, batch requests bypassing contexts, heavy work on viewContext and swallowed save errors.
tags: [CWE-362]
activation:
  content:
    - '\bNSManagedObject(?:Context|ID)?\b|\bviewContext\b|\bnewBackgroundContext\(|\bperformBackgroundTask\b|\.perform(?:AndWait)?\s*[({]'
    - '\bNSBatch(?:Delete|Update|Insert)Request\b|\bautomaticallyMergesChangesFromParent\b|\bmergePolicy\b|\bobjectID\b|\.save\(\)'
  examples:
    - 'container.viewContext.perform { try? container.viewContext.save() }'
    - 'let deleteRequest = NSBatchDeleteRequest(fetchRequest: request)'
sources:
  - https://developer.apple.com/documentation/coredata/using-core-data-in-the-background
  - https://developer.apple.com/documentation/coredata/nsbatchdeleterequest
  - https://developer.apple.com/documentation/coredata/nsmanagedobjectcontext/mergepolicy
  - https://developer.apple.com/documentation/coredata/nsmanagedobjectid/istemporaryid
---
- **Objects crossing queues**: managed objects or contexts used off their queue (`viewContext` in background work, objects captured in `Task`/GCD closures or returned from `perform`) → crashes and corruption. Fix: `perform`, pass `NSManagedObjectID`; test with `-com.apple.CoreData.ConcurrencyDebug 1`.
- **Temporary IDs**: an inserted but unsaved object's `objectID` is temporary → it fails to resolve in other contexts or after save. Fix: save first or `obtainPermanentIDs(for:)`.
- **No merging**: `viewContext.automaticallyMergesChangesFromParent` is `false` by default → the UI never shows background saves.
- **Merge conflicts**: the default `NSErrorMergePolicy` makes a save fail when another context changed the same objects — often hidden by `try?` → lost writes. Fix: an explicit merge policy and handled save errors.
- **Batch requests bypass contexts**: `NSBatchDeleteRequest`/`NSBatchUpdateRequest`/`NSBatchInsertRequest` change SQLite directly → in-memory objects and the UI stay stale. Fix: request `resultTypeObjectIDs` and `mergeChanges(fromRemoteContextSave:into:)`, or persistent history.
- **Heavy work on viewContext**: JSON imports and large fetches on the main-queue context → UI hangs. Fix: a private-queue context.
