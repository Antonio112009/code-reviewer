---
name: Mass assignment and model serialization
description: Model attributes exposed in both directions — request data mass-assigned (unguarded models, builder updates that skip $fillable, forceFill) and models or resources serializing every column, relation and new secret field.
priority: 72
tags: [CWE-915, CWE-200, OWASP-A01]
activation:
  content:
    - '\$request->(?:all|input|except|post|json)\s*\(|request\(\)->(?:all|input|except)\s*\('
    - '\$(?:fillable|guarded|hidden|visible|appends)\b|#\[(?:Fillable|Guarded|Unguarded|Hidden|Visible)\b|::unguard\s*\('
    - '->(?:forceFill|forceCreate|makeVisible|setVisible)\s*\(|\bextends\s+(?:JsonResource|ResourceCollection)\b'
  examples:
    - '$user = User::create($request->all());'
    - 'protected $guarded = [];'
    - 'class UserResource extends JsonResource'
sources:
  - https://laravel.com/docs/13.x/eloquent#mass-assignment
  - https://laravel.com/docs/13.x/eloquent-serialization
  - https://laravel.com/docs/13.x/eloquent-resources
---
- **Unfiltered input**: `create($request->all())`, `fill($request->input())`, `update($request->except('id'))` on models with `$guarded = []`, `#[Unguarded]` or `Model::unguard()` → clients set `is_admin`, `user_id`, `team_id`. Fix: `validated()` plus explicit fillable attributes.
- **Builder writes skip fillable**: `User::where(...)->update($request->all())`, `insert()`, `upsert()` and `forceFill()`/`forceCreate()` ignore mass-assignment protection → any column is writable. Fix: pass only named, validated keys.
- **Privileged fillable columns**: ownership or state columns (`user_id`, `role`, `status`, `email_verified_at`) listed as fillable and fed from validated input → privilege escalation once a rule is loosened. Fix: set them from the auth context.
- **Silently discarded fields**: keys missing from the fillable list are dropped without error → a new form field is never saved. Fix: `Model::preventSilentlyDiscardingAttributes()` outside production.
- **Returning models**: routes returning models, collections or paginators serialize every attribute not hidden → newly added columns (tokens, 2FA secrets, notes) leak automatically. Fix: API Resources with explicit fields, or visible allowlists.
- **Resources that dump everything**: `toArray()` returning `parent::toArray($request)` or `$this->resource->toArray()`, loaded relations serialized wholesale, `makeVisible()` driven by input → hidden fields and related users' data exposed. Fix: explicit arrays, `whenLoaded()`.
