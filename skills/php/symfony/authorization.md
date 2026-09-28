---
name: Voters and object authorization
description: Symfony authorization traps — the affirmative strategy overruling deny voters, grant-by-default voters, abstaining voters with allow_if_all_abstain, entity arguments (MapEntity) without IsGranted, and ignored isGranted() results.
priority: 72
tags: [CWE-639, CWE-862, CWE-863, OWASP-A01]
activation:
  content:
    - '\bextends\s+Voter\b|\bVoterInterface\b|\bfunction\s+(?:supports|voteOnAttribute)\s*\('
    - '#\[(?:IsGranted|MapEntity|CurrentUser)\b|->(?:denyAccessUnlessGranted|isGranted)\s*\('
    - '\ballow_if_all_abstain\b|\bstrategy:\s*\w+'
  examples:
    - 'class PostVoter extends Voter'
    - '#[IsGranted(''EDIT'', subject: ''post'')]'
    - 'allow_if_all_abstain: true'
sources:
  - https://symfony.com/doc/current/security/voters.html
  - https://symfony.com/doc/current/security.html#securing-controllers-and-other-code
  - https://symfony.com/doc/current/doctrine.html#automatically-fetching-objects-entityvalueresolver
---
- **Affirmative strategy**: by default access is granted as soon as one voter grants → a new voter that denies (suspended account, wrong tenant) is overruled by any granting voter. Fix: `unanimous` or `priority` strategy, or deny inside the granting voter.
- **Grant by default**: `voteOnAttribute()` ending in `return true`, a `match` with a granting `default`, or role checks that ignore the subject → every object accessible.
- **Abstaining voters**: `supports()` returning false for a subject type or misspelled attribute makes the voter abstain; with `allow_if_all_abstain: true` that becomes a grant.
- **Entity arguments**: `#[MapEntity]` (explicit mapping is required in Symfony 8) and resolved `Post $post` arguments load any id → IDOR unless `#[IsGranted('EDIT', subject: 'post')]` or `denyAccessUnlessGranted()` checks that object.
- **Ignored results**: `$this->isGranted()` or `AuthorizationCheckerInterface::isGranted()` without acting on the boolean, and `is_granted()` in Twig that only hides UI → the action stays reachable. Fix: `denyAccessUnlessGranted()`.
- **Collections**: authorizing the parent (`#[IsGranted('VIEW', 'project')]`) but returning its children via unscoped repository queries → foreign rows. Fix: filter queries by the authorized scope.
