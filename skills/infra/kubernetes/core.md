---
name: Kubernetes & Helm
description: Workload, rollout, RBAC, network-policy and Helm templating defects in Kubernetes manifests and charts, such as heap/limit mismatches, cascading probes, unsafe shutdown, privileged pods, immutable-field changes, HPA fights, falsy Helm defaults and regenerated secrets.
category: infra
priority: 60
tier: essential
tags:
  - CWE-250
  - CWE-269
  - CWE-284
  - CWE-770
  - OWASP-A01
  - OWASP-A02
activation:
  stack:
    - infra.kubernetes
    - infra.helm
  languages:
    - yaml
    - text
  files:
    - "**/Chart.yaml"
    - "**/values*.{yaml,yml}"
    - "**/_*.tpl"
    - "**/{kustomization,helmfile,skaffold}.{yaml,yml}"
    - "**/*{deployment,statefulset,daemonset,cronjob,ingress,networkpolicy,hpa,pdb,rbac,serviceaccount}*.{yaml,yml}"
    - "**/templates/**/*.{yaml,yml,tpl}"
    - "**/{k8s,kube,kubernetes,manifests,helm,charts,overlays,deploy}/**/*.{yaml,yml}"
  content:
    - ^kind:[ \t]*(?:Deployment|StatefulSet|DaemonSet|Job|CronJob|Pod|Service|Ingress|ConfigMap|Secret|Role|ClusterRole|RoleBinding|ClusterRoleBinding|NetworkPolicy|HorizontalPodAutoscaler|PodDisruptionBudget|ServiceAccount|PersistentVolumeClaim)\b
    - \{\{-?[ \t]*(?:\.Values\b|include[ \t]|toYaml[ \t]|tpl[ \t]|required[ \t]|lookup[ \t])
    - "^[ \\t]*(?:-[ \\t]+)?(?:livenessProbe|readinessProbe|startupProbe|securityContext|serviceAccountName|automountServiceAccountToken|terminationGracePeriodSeconds|preStop|containerPort|targetPort|imagePullPolicy|matchLabels|podSelector|namespaceSelector|policyTypes|concurrencyPolicy|minAvailable|maxUnavailable|apiGroups|volumeClaimTemplates|hostPath|hostNetwork|allowPrivilegeEscalation|runAsNonRoot):"
  examples:
    - 'kind: Deployment'
    - 'replicas: {{ .Values.replicaCount }}'
    - '      livenessProbe:'
---
- **Heap vs limit**: no memory limit, or a heap near or over it (`-Xmx`, `--max-old-space-size`, Go without `GOMEMLIMIT`) → OOMKilled loops. Fix: derive heap from the limit.
- **Probe cascades**: liveness probes checking databases or downstream services, the 1 s default `timeoutSeconds`, slow starts without `startupProbe` → restart storms under load or dependency blips.
- **Unsafe shutdown**: no `preStop` delay (endpoints update after SIGTERM), unhandled SIGTERM, a grace period shorter than preStop plus drain → dropped requests each rollout. Fix: `preStop.sleep`.
- **Privilege paths**: privileged, `hostPath` or host-network pods, privilege escalation allowed; RBAC `*`, `list` on secrets (returns values), `create` on pods, `nodes/proxy`, `escalate`/`bind` → cluster takeover.
- **Immutable fields**: changed `spec.selector` labels or StatefulSet `volumeClaimTemplates` → apply and upgrades fail; Service selector or `targetPort` mismatches → no endpoints, 503s.
- **Scale fights**: `replicas` on an HPA target → reset on each apply; CPU-utilization HPAs without CPU requests → never scale; PDB `minAvailable` ≥ replicas → blocked node drains.
- **Falsy Helm defaults**: `default` treats false, 0 and "" as unset → `default true` cannot be disabled; unquoted `on`, `1.10` and big ints coerce. Fix: `hasKey`, `quote`.
- **Regenerated secrets**: `randAlphaNum`/`genCA` in templates, or `lookup` (empty in `helm template` and Argo CD) → passwords and certs rotate on every upgrade.
- **Stale config**: ConfigMaps or Secrets consumed via env or `subPath` without a `checksum/config` annotation or hashed name → changes never reach running pods.
- **NetworkPolicy gaps**: `Egress` policies without DNS (53 UDP/TCP) → resolution fails; `namespaceSelector` and `podSelector` in separate `from` items OR instead of AND → traffic opened.
- **Jobs and volumes**: CronJobs allowing overlap (default) or retrying non-idempotent work, schedules without `timeZone`; chart PVCs without `helm.sh/resource-policy: keep` → duplicate runs, data lost on uninstall.
