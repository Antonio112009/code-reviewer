---
name: Polars nulls, joins and lazy plans
description: Polars 1.x pitfalls — NaN is not null, null join keys never match and validate defaults to m:m, unordered group_by/join output, strict casts and 100-row schema inference, regex str.contains, un-collected or re-collected LazyFrames, slow Python UDFs and forgotten reassignment.
priority: 58
activation:
  content:
    - "\\.(?:is_null|fill_null|drop_nulls|null_count|is_nan|fill_nan)\\s*\\("
    - "\\.join\\s*\\(|\\.group_by\\s*\\(|\\.unique\\s*\\("
    - "\\.cast\\s*\\(|\\bread_csv\\s*\\(|\\bscan_\\w+\\s*\\(|\\binfer_schema_length\\b"
    - "\\.str\\.contains\\s*\\(|\\.(?:lazy|collect|collect_all)\\s*\\(|\\.(?:map_elements|map_rows)\\s*\\("
    - "^[ \\t]*\\w+\\.(?:with_columns|rename|drop|filter|sort)\\s*\\("
sources:
  - https://docs.pola.rs/user-guide/expressions/missing-data/
  - https://docs.pola.rs/api/python/stable/reference/dataframe/api/polars.DataFrame.join.html
  - https://docs.pola.rs/api/python/stable/reference/dataframe/api/polars.DataFrame.group_by.html
  - https://docs.pola.rs/api/python/stable/reference/api/polars.read_csv.html
---
- **NaN is not null**: `is_null`, `fill_null` and `drop_nulls` ignore float NaN, and aggregations skip nulls but propagate NaN. Fix: `fill_nan(None)` on load.
- **Null join keys**: nulls never match by default (`nulls_equal=False`, called `join_nulls` before 1.24) and `validate` defaults to `"m:m"` (no check) → dropped rows or row explosion. Fix: handle null keys; `validate="1:1"`/`"m:1"`.
- **Unordered output**: `group_by` and joins without `maintain_order`, and `unique()`, don't guarantee order → "first" rows and exports change between runs. Fix: `maintain_order=` or `sort`.
- **Casts and inference**: `cast` raises on bad values (`strict=False` silently nulls them) and `read_csv` infers types from the first 100 rows → ComputeError deep into a file. Fix: `schema_overrides`.
- **Regex by default**: `str.contains(term)` treats the term as a regex → `.`, `(` or `+` misbehave. Fix: `literal=True`.
- **Lazy plans**: without `.collect()` nothing runs; `collect()` inside a loop re-executes the whole plan each time. Fix: collect once or `pl.collect_all`.
- **Python UDFs**: `map_elements`/`map_rows` run Python per row outside the optimizer and guess the output dtype. Fix: native expressions; `return_dtype=`.
- **Immutable frames**: `df.with_columns(...)` or `df.drop(...)` without reassignment does nothing. Fix: `df = df.with_columns(...)`.
