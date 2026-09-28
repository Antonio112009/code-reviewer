---
name: pandas dtypes, parsing and missing values
description: Silent data corruption in pandas — NaN turning ints into floats, read_csv inference, the default str dtype and microsecond datetimes in 3.0, errors="coerce", boolean-mask operators, and zoneinfo instead of pytz (3.0).
priority: 60
activation:
  content:
    - "\\bread_(?:csv|excel|json|parquet|sql|table)\\s*\\(|\\bto_(?:datetime|numeric)\\s*\\("
    - "\\.astype\\s*\\(|\\.dtypes?\\s*==|\\bselect_dtypes\\s*\\(|\\bdtype\\s*=|\\bdtype_backend\\b"
    - "==\\s*(?:np\\.nan|None|pd\\.NA)\\b|\\.fillna\\s*\\(|\\.isna\\s*\\(|\\bpd\\.NA\\b"
    - "\\)\\s*(?:and|or)\\s*\\(?\\s*df\\b|\\bdf\\w*\\[[^\\]\\n]{0,80}\\]\\s*[<>=!]=?[^&|\\n]{1,40}&"
    - "\\.(?:tz_localize|tz_convert)\\s*\\(|\\.tz\\.(?:zone|localize)\\b|\\bas_unit\\s*\\("
  examples:
    - 'df = pd.read_csv("data.csv", dtype={"zip": str})'
    - 'df["id"] = df["id"].astype("Int64")'
    - 'mask = df["x"] == np.nan'
    - 'mask = df["a"] > 1 & df["b"] < 2'
    - 'df["ts"] = df["ts"].dt.tz_localize("UTC")'
sources:
  - https://pandas.pydata.org/docs/whatsnew/v3.0.0.html
  - https://pandas.pydata.org/docs/user_guide/missing_data.html
  - https://pandas.pydata.org/docs/reference/api/pandas.read_csv.html
  - https://pandas.pydata.org/docs/user_guide/migration-3-strings.html
---
- **NaN changes dtypes**: one missing value turns an int column into `float64` (ids become `1.0`, big ints lose precision) and `astype(int)` then raises. Fix: nullable dtypes (`"Int64"`, `dtype_backend="pyarrow"`).
- **CSV inference**: `read_csv` strips leading zeros (ZIP codes, account numbers) and reads `"NA"` or `"null"` as missing. Fix: `dtype={"zip": str}`, `keep_default_na=False`.
- **Default `str` dtype (3.0)**: strings infer `str`, not `object` → `dtype == object` checks, `select_dtypes("object")` and writing non-strings break. Fix: `pd.api.types.is_string_dtype`.
- **Datetime resolution (3.0)**: parsed strings become `datetime64[us]`, not `ns` → `astype("int64")` epochs are 1000× smaller. Fix: `.dt.as_unit("ns")` first.
- **Silent coercion**: `errors="coerce"` in `to_datetime`/`to_numeric` turns bad input into NaT/NaN silently; ambiguous dates swap day and month. Fix: explicit `format=`; count new nulls.
- **Mask operators and NaN**: `and`/`or` on Series raise "truth value is ambiguous"; `df.a > 1 & df.b < 2` binds `&` first; `s == np.nan` is always False. Fix: `(df.a > 1) & (df.b < 2)`, `.isna()`.
- **Time zones (3.0)**: zone strings yield `zoneinfo`, not pytz (no longer installed) → `.tz.zone`/`.tz.localize()` fail. Fix: `tz.key`.
