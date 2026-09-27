---
name: UITableView and UICollectionView updates
description: List update crashes and stale cells — batch updates out of sync with the model, delete/insert index order, diffable snapshots with duplicate or content-hashed identifiers applied from mixed queues, and async content landing in reused cells.
activation:
  content:
    - '\bUI(?:Table|Collection)View\b|\bDiffableDataSource\b|\bNSDiffableDataSourceSnapshot\b|\bdequeueReusable\w+\('
    - '\.(?:performBatchUpdates|insertRows|deleteRows|insertItems|deleteItems|reloadItems|reconfigureItems|moveRow|moveItem|apply)\(|\bprepareForReuse\b|\bcellFor(?:Row|Item)\b'
sources:
  - https://developer.apple.com/documentation/uikit/uitableview/performbatchupdates(_:completion:)
  - https://developer.apple.com/documentation/uikit/uicollectionviewdiffabledatasource-9tqpa/apply(_:animatingdifferences:completion:)
  - https://developer.apple.com/documentation/uikit/nsdiffabledatasourcesnapshot-swift.struct
---
- **Model and updates out of sync**: `insertRows`/`deleteRows`/`insertItems` or `performBatchUpdates` when the data source's counts don't match (model changed before, after or twice) → `NSInternalInconsistencyException` crash. Fix: mutate the model inside the updates block, or use a diffable data source.
- **Batch index order**: in batch updates deletes are processed first against the old indexes and inserts against the post-delete state → index paths computed otherwise crash or animate the wrong rows.
- **Diffable identifiers**: duplicate item or section identifiers in a snapshot crash; identifiers hashing mutable content turn edits into delete+insert (lost selection, flicker). Fix: stable ids plus `reconfigureItems` (iOS 15+); class ids must be `NSObject` subclasses with `isEqual`/`hash`.
- **Snapshot queue**: applying snapshots sometimes on main and sometimes on a background queue → corrupted state. Fix: always the same queue, normally main.
- **Reused cells**: async image or data loads completing into a cell that was reused for another row → wrong content. Fix: check the item identity on completion or cancel in `prepareForReuse`.
- **Mutating visible cells**: updating `cellForRow(at:)`/`cellForItem(at:)` directly (nil when off-screen, force-unwrapped) instead of the model → crashes and changes lost on reuse.
