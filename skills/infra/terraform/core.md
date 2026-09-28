---
name: Terraform / OpenTofu
description: Plan and state defects in Terraform/OpenTofu code, such as forced replacement of stateful resources, index and key shifts, lost destroy guards, open ingress, wildcard IAM or OIDC trust, secrets in state, perpetual diffs, conflicting resources, unpassed provider aliases and IAM propagation races.
category: infra
priority: 62
tier: essential
tags:
  - CWE-284
  - CWE-732
  - CWE-312
  - CWE-829
  - OWASP-A01
  - OWASP-A02
  - OWASP-A03
activation:
  stack:
    - infra.terraform
  languages:
    - terraform
    - text
  files:
    - "**/*.tf"
    - "**/*.tofu"
    - "**/*.tfvars"
    - "**/*.tftest.hcl"
    - "**/terragrunt.hcl"
    - "**/.terraform.lock.hcl"
  content:
    - ^[ \t]*(?:resource|data|ephemeral)[ \t]+"[\w-]+"[ \t]+"[\w-]+"[ \t]*\{
    - ^[ \t]*(?:module|provider|variable|output|check)[ \t]+"[\w-]+"[ \t]*\{
    - ^[ \t]*(?:terraform|moved|removed)[ \t]*\{
  examples:
    - 'resource "aws_security_group" "web" {'
    - 'module "vpc" {'
    - 'moved {'
---
- **Forced replacement**: edits to replace-forcing attributes (names, `engine`, `availability_zone`, subnet or KMS ids) or renamed resources and modules without `moved` → destroy and recreate, data loss.
- **Key shifts**: `count` over a list (a removed item shifts later indexes) or changed `for_each` keys → unrelated resources destroyed and recreated. Fix: stable keys, `moved`.
- **Destroy guards**: stateful resources without `deletion_protection`, or with `skip_final_snapshot`/`force_destroy = true`; `prevent_destroy` vanishes with a deleted block → irrecoverable loss. Fix: `removed` with `destroy = false`.
- **Open ingress**: `0.0.0.0/0` or `::/0` on SSH, RDP or database ports, `publicly_accessible = true`, disabled S3 public-access blocks → exposed to the internet.
- **Wildcard trust**: IAM `Action`/`Resource = "*"`, `iam:PassRole` on `*`, `Principal = "*"`, OIDC trust without an exact `sub` (repo and ref) → any account or repo assumes the role.
- **Secrets in state**: `random_password`, secret data sources and `sensitive` variables or outputs land in plaintext state → readable by anyone with state access. Fix: `ephemeral` values, write-only `*_wo` arguments.
- **Unpinned sources**: providers without version constraints, git modules without `?ref=` tag or SHA, registry modules without `version`, uncommitted `.terraform.lock.hcl` → surprise upgrades.
- **Perpetual diffs**: `timestamp()` or `uuid()` in arguments, `depends_on` on modules or data sources (reads deferred to apply) → changes or replacements every plan; `ignore_changes = all` hides drift.
- **Resource conflicts**: `aws_iam_policy_attachment` (exclusive account-wide), inline `ingress`/`egress` mixed with rule resources, `create_before_destroy` with fixed names → attachments removed elsewhere, flapping rules, name collisions.
- **Wrong provider**: aliased providers not passed via `providers = { aws = aws.x }` → module resources created in the default region or account.
- **IAM propagation**: roles consumed by Lambda, ECS or EKS before their policy attachments exist (no reference or `depends_on`) → first apply fails or runs without permissions.
