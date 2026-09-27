---
name: pandas Copy-on-Write (3.0)
description: Writes that stop reaching the DataFrame under pandas 3.0 Copy-on-Write — chained assignment, inplace methods on selected columns, subsets that no longer propagate, read-only NumPy views, constructor copies and leftover defensive copies.
priority: 62
activation:
  content:
    - "\\]\\s*\\[[^\\n]{1,160}?\\]\\s*=[^=]"
    - "\\binplace\\s*=\\s*True\\b"
    - "\\.to_numpy\\s*\\(|\\.values\\b|\\bSettingWithCopyWarning\\b|\\bcopy_on_write\\b|\\bChainedAssignmentError\\b"
sources:
  - https://pandas.pydata.org/docs/whatsnew/v3.0.0.html#consistent-copy-view-behaviour-with-copy-on-write
  - https://pandas.pydata.org/docs/user_guide/copy_on_write.html
---
- **Chained assignment is a no-op**: `df["col"][mask] = v`, `df[df.a > 0]["b"] = v` or `df.loc[i]["x"] = v` write into a temporary copy under Copy-on-Write (default in pandas 3.0) → data silently unchanged. Fix: one `df.loc[mask, "col"] = v`.
- **Inplace methods on a selection**: `df["col"].fillna(0, inplace=True)` or `.replace(..., inplace=True)` on a selected column no longer modify `df`. Fix: `df["col"] = df["col"].fillna(0)`.
- **Subsets never write back**: changing `sub = df[cols]` or `s = df["a"]` never modifies `df` in 3.0 (before, it sometimes did) → code relying on views stops propagating updates. Fix: assign into `df` directly.
- **Read-only arrays**: `.to_numpy()`/`.values` may return a non-writeable view → in-place NumPy edits raise "assignment destination is read-only". Fix: `.to_numpy(copy=True)`.
- **Constructor copies**: `pd.Series(arr)`/`pd.DataFrame(arr)` copy NumPy input by default in 3.0 → later edits to `arr` no longer show up. Fix: don't rely on shared memory.
- **Upgrade leftovers**: `.copy()` calls added to silence SettingWithCopyWarning now only cost memory; `mode.copy_on_write` has no effect in 3.0. Fix: remove them; upgrade via 2.3 with warnings on.
