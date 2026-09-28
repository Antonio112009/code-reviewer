---
name: Change tracking and updates
description: EF Core update defects — Update/Attach on detached entities overwriting unsent columns, graph attaches inserting related rows, edits to no-tracking entities, "already tracked" conflicts, entities mutated for display being saved and SaveChanges per item.
priority: 66
tags: [CWE-915, CWE-639]
activation:
  content:
    - '\.(?:Update|UpdateRange|Attach|AttachRange|Entry)\(|\bEntityState\.\w+|\.State\s*='
    - '\bAsNoTracking(?:WithIdentityResolution)?\(|\bQueryTrackingBehavior\b|\.SetValues\('
    - '\bSaveChanges(?:Async)?\('
  examples:
    - 'context.Update(order);'
    - 'entry.State = EntityState.Modified;'
    - 'context.Entry(order).CurrentValues.SetValues(dto);'
    - 'var orders = await context.Orders.AsNoTracking().ToListAsync();'
    - 'await context.SaveChangesAsync();'
sources:
  - https://learn.microsoft.com/en-us/ef/core/saving/disconnected-entities
  - https://learn.microsoft.com/en-us/ef/core/change-tracking/identity-resolution
  - https://learn.microsoft.com/en-us/ef/core/querying/tracking
---
- **Update on detached entities**: `context.Update(entityBuiltFromDto)` or `Attach` + `State = Modified` marks every column modified → properties the client didn't send overwrite database values with nulls/zeros. Fix: load, copy allowed fields (`Entry(e).CurrentValues.SetValues(dto)`), save.
- **Graph attach**: `Add`/`Update` on an entity holding navigation objects → related entities without keys are inserted as new (duplicates) and keyed ones updated wholesale. Fix: set foreign-key ids instead of navigation objects; attach only the root.
- **No-tracking edits**: modifying entities from `AsNoTracking()` queries (or another context) and calling `SaveChanges` saves nothing; attaching them later throws "another instance with the same key value is already being tracked". Fix: tracked query for updates, or `Entry(...).CurrentValues.SetValues`.
- **Accidental writes**: tracked entities changed for display, masking or formatting (`user.Email = Mask(user.Email)`) are persisted by any later `SaveChanges` in the same context. Fix: project to DTOs, `AsNoTracking` for reads.
- **Tracking big reads**: large read-only queries tracked by default → memory and `DetectChanges` cost. Fix: `AsNoTracking()` or `QueryTrackingBehavior.NoTracking`.
- **SaveChanges per item**: `SaveChangesAsync()` inside loops → one round-trip and transaction per entity, partial saves on failure. Fix: batch changes, save once.
