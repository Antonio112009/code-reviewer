---
name: pandas joins, groupby and alignment
description: Wrong row counts and totals — many-to-many merge explosions, dropped or unmatched keys, NaN keys vanishing from groupby, observed=True default and apply without grouping columns (3.0), index alignment and order assumptions.
priority: 58
activation:
  content:
    - "\\.merge\\s*\\(|\\bpd\\.merge\\s*\\(|\\.join\\s*\\([^)\\n]{0,80}\\b(?:on|how)\\s*="
    - "\\.groupby\\s*\\(|\\.pivot(?:_table)?\\s*\\(|\\.value_counts\\s*\\("
    - "\\bpd\\.concat\\s*\\(|\\.drop_duplicates\\s*\\(|\\.reset_index\\s*\\("
sources:
  - https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.merge.html
  - https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.groupby.html
  - https://pandas.pydata.org/docs/whatsnew/v3.0.0.html
---
- **Row explosion**: `merge` on keys duplicated on both sides multiplies rows (many-to-many) → double-counted totals. Fix: `validate="one_to_one"`/`"many_to_one"`; compare row counts.
- **Dropped rows and key dtypes**: the default `how="inner"` drops unmatched rows; keys of different dtypes (int vs str after CSV, `Int64` vs `object`) raise or never match. Fix: explicit `how=`, normalized key dtypes, `indicator=True` to audit.
- **NaN keys disappear**: `groupby` drops NaN/None keys by default (`dropna=True`) and `value_counts()` hides NaN → totals don't add up. Fix: `dropna=False`, or fill keys first.
- **Categorical groupings (3.0)**: `observed` now defaults to True → unused categories no longer appear as groups → missing report rows. Fix: `observed=False` where every category must show.
- **`apply` without grouping columns (3.0)**: `DataFrameGroupBy.apply` no longer passes grouping columns to the function (`include_groups=True` removed) → KeyError. Fix: select columns explicitly or use `agg`/`transform`.
- **Index alignment**: arithmetic and assignment between Series/frames align on labels, not positions → NaNs or misplaced values after filtering; `concat` without `ignore_index=True` duplicates labels. Fix: `reset_index(drop=True)`.
- **Order assumptions**: "first"/"last" rows after `groupby`, `merge` or `drop_duplicates` without sorting depend on input order. Fix: `sort_values` first.
