---
name: Relationships and cascade delete
description: EF Core relationship defects — cascade delete by convention on required relationships, ClientSetNull failing for unloaded dependents, orphan deletion when removing or re-parenting children, and SQL Server multiple-cascade-path errors fixed by dropping cascades entirely.
priority: 64
tags: [CWE-1041]
activation:
  content:
    - '\bOnDelete\(|\bDeleteBehavior\.|\bHas(?:One|Many)\(|\bWith(?:One|Many)\(|\bHasForeignKey\('
    - '\.(?:Remove|RemoveRange)\(|\.Clear\(\)|\bCascadeDeleteTiming\b|\bDeleteOrphansTiming\b'
  examples:
    - 'builder.HasOne(o => o.Customer).WithMany(c => c.Orders).HasForeignKey(o => o.CustomerId).OnDelete(DeleteBehavior.Restrict);'
    - 'order.Lines.Remove(line);'
    - 'context.ChangeTracker.CascadeDeleteTiming = CascadeTiming.OnSaveChanges;'
sources:
  - https://learn.microsoft.com/en-us/ef/core/saving/cascade-delete
  - https://learn.microsoft.com/en-us/ef/core/change-tracking/relationship-changes
  - https://learn.microsoft.com/en-us/ef/core/modeling/relationships
---
- **Cascade by convention**: required relationships (non-nullable FK) default to `Cascade` → deleting a customer, product or user also deletes orders, invoices, payments or audit rows. Fix: `OnDelete(DeleteBehavior.Restrict/NoAction)` for business-critical dependents; soft delete.
- **ClientSetNull with unloaded dependents**: optional relationships default to `ClientSetNull` — EF nulls FKs only on tracked dependents while the database FK is `NO ACTION` → deleting a principal with unloaded dependents fails (FK violation). Fix: load dependents or `SetNull` in the database.
- **Orphans deleted**: removing a child from a required collection (`order.Lines.Remove(line)`), `Clear()` or replacing the collection → EF deletes those rows on `SaveChanges`, not just "unlinks" them. Fix: reassign to another parent or make the relationship optional.
- **Re-parenting**: orphans are marked `Deleted` as soon as the change is detected (`DeleteOrphansTiming`/`CascadeDeleteTiming` = `Immediate`) → moving a child between parents (remove, then add) can delete it. Fix: `CascadeTiming.OnSaveChanges` when re-parenting.
- **Multiple cascade paths**: SQL Server rejects models with cycles or multiple cascade paths; switching everything to `NoAction` to make the migration pass leaves orphans or FK errors. Fix: keep one database cascade path; `ClientCascade` plus explicit deletes for the others.
