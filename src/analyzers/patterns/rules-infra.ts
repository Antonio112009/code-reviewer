import { CONFIG, JS, type MatchContext, type PatternRule, SHELLISH, WORKFLOW_PATHS } from './types';

/**
 * True when the matched line belongs to a `run:` (or github-script `script:`) value: either the key is on
 * the same line, or the nearest less-indented line above opens a `run: |` / `script: >` block.
 */
export function inRunBlock({ lines, index }: MatchContext): boolean {
  const line = lines[index] ?? '';
  if (/^\s*(?:-\s+)?(?:run|script)\s*:/.test(line)) return true;
  const indent = line.search(/\S/);
  for (let i = index - 1; i >= 0 && i >= index - 300; i--) {
    const above = lines[i] ?? '';
    const aboveIndent = above.search(/\S/);
    if (aboveIndent === -1 || above[aboveIndent] === '#') continue; // blank or comment line
    if (aboveIndent < indent) return /^\s*(?:-\s+)?(?:run|script)\s*:\s*[|>]/.test(above);
  }
  return false;
}

interface DockerfileFacts {
  /** Build stage names (`FROM <image> AS <name>`), lower-cased: Docker compares them case-insensitively. */
  stages: Set<string>;
  /** Index of the last `USER` instruction that switches to a non-root user (-1: none). */
  lastNonRootUser: number;
}

const dockerfileFacts = new WeakMap<readonly string[], DockerfileFacts>();

/** Facts about the scanned Dockerfile, computed in one pass per scan (not once per matched line). */
function factsOf(lines: readonly string[]): DockerfileFacts {
  let facts = dockerfileFacts.get(lines);
  if (!facts) {
    facts = { stages: new Set(), lastNonRootUser: -1 };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const stage = /^\s*FROM\s+(?:--\S+\s+){0,4}\S+\s+AS\s+(\S+)\s*$/i.exec(line)?.[1];
      if (stage) facts.stages.add(stage.toLowerCase());
      else if (/^\s*USER\s+(?!root\b|0\b)\S/i.test(line)) facts.lastNonRootUser = i;
    }
    dockerfileFacts.set(lines, facts);
  }
  return facts;
}

/** Base image reference is unpinned (`:latest` or no tag/digest) and not a build stage or `scratch`. */
function unpinnedImage({ match, lines }: MatchContext): boolean {
  const image = match[1] ?? '';
  if (!image || /^scratch$/i.test(image) || image.includes('$') || image.includes('@sha256:')) return false;
  const tag = /:([^/:]+)$/.exec(image)?.[1];
  if (tag) return tag === 'latest';
  return !factsOf(lines).stages.has(image.toLowerCase());
}

/** `USER root` that is not followed by a switch to another user later in the Dockerfile. */
function staysRoot({ lines, index }: MatchContext): boolean {
  return factsOf(lines).lastNonRootUser < index;
}

/** Not an egress/outbound rule (open egress is normal). */
function notEgress({ lines, index }: MatchContext): boolean {
  const context = lines.slice(Math.max(0, index - 8), index + 1).join('\n');
  return !/egress|outbound|0\.0\.0\.0\/0\s*#\s*allow-all-egress/i.test(context);
}

/** GitHub event fields an outside contributor controls. */
const UNTRUSTED_GITHUB_CONTEXT = String.raw`github\.(?:event\.(?:issue\.(?:title|body)|pull_request\.(?:title|body|head\.(?:ref|label)|head\.repo\.default_branch)|comment\.body|review\.body|review_comment\.body|discussion(?:_comment)?\.(?:title|body)|pages\.[\w[\]*.]{0,40}\.page_name|commits\.[\w[\]*.]{0,40}\.(?:message|author\.(?:email|name))|head_commit\.(?:message|author\.(?:email|name))|workflow_run\.(?:head_branch|head_commit\.(?:message|author\.(?:email|name))|display_title))|head_ref)`;

const SHELL_RULES: PatternRule[] = [
  {
    id: 'sh-curl-pipe-shell',
    languages: [...SHELLISH, 'markdown'],
    regex: /\b(?:curl|wget)\b[^|\n]{0,300}\|\s*(?:sudo\s+(?:-\S+\s+){0,4})?(?:ba|z|k|da|fi)?sh\b/,
    severity: 'major',
    category: 'security',
    confidence: 0.5,
    cwe: 'CWE-494',
    skill: 'security/supply-chain',
    message:
      'Remote script piped straight into a shell: no integrity check, a compromised or spoofed server runs code here.',
    help: 'Download, verify a checksum/signature, then execute; or install a pinned package.',
  },
  {
    id: 'sh-eval-variable',
    languages: ['shell', 'makefile', 'dockerfile'],
    regex: /(?<![\w-])eval\s+["']?\$/,
    severity: 'major',
    category: 'security',
    confidence: 0.45,
    cwe: 'CWE-95',
    skill: 'shell/core',
    message: '`eval` of a variable re-parses its contents as shell code (injection).',
    help: 'Use arrays and direct invocation instead of eval.',
  },
  {
    id: 'sh-rm-rf-variable',
    languages: SHELLISH,
    regex:
      /\brm\s+-[a-zA-Z]*(?:r[a-zA-Z]*f|f[a-zA-Z]*r)[a-zA-Z]*\s+(?:--\s+)?["']?\$\{?[A-Za-z_]\w*\}?["']?(?:\/|\s|$)/,
    notIf: /\$\{[A-Za-z_]\w*:\?/,
    severity: 'major',
    category: 'data-loss',
    confidence: 0.45,
    skill: 'shell/core',
    message: '`rm -rf $VAR…`: if the variable is empty or unset this deletes from / or the wrong tree.',
    help: `Use "\${VAR:?}" and \`set -u\`.`,
  },
  {
    id: 'chmod-world-writable',
    languages: [...SHELLISH, 'python', ...JS, 'go', 'ruby', 'php'],
    regex:
      /\bchmod\s+(?:-[a-zA-Z]+\s+)?(?:0?777|a\+rwx|o\+w)\b|\b(?:os\.)?[Cc]hmod(?:Sync)?\s*\([^,)]{1,120},\s*0o?777\s*\)/,
    severity: 'minor',
    category: 'security',
    confidence: 0.45,
    cwe: 'CWE-732',
    skill: 'security/core',
    message: 'World-writable permissions: any local user or process can modify the file.',
    help: 'Grant the minimum (e.g. 0755 / 0644).',
  },
  {
    id: 'insecure-tls-cli',
    languages: SHELLISH,
    regex:
      /\bcurl\b[^\n]{0,300}\s(?:-[a-zA-Z]*k[a-zA-Z]*|--insecure)\b|\bwget\b[^\n]{0,300}\s--no-check-certificate\b|\bgit\s+config\b[^\n]{0,80}http\.sslVerify\s+false|\bGIT_SSL_NO_VERIFY\s*=\s*['"]?(?:1|true)/,
    severity: 'major',
    category: 'security',
    confidence: 0.5,
    cwe: 'CWE-295',
    skill: 'shell/core',
    message:
      'TLS verification disabled for a download (curl -k / --no-check-certificate): MITM can swap the payload.',
    help: 'Keep verification on; add the CA certificate if needed.',
  },
];

const DOCKER_RULES: PatternRule[] = [
  {
    id: 'docker-unpinned-image',
    languages: ['dockerfile'],
    regex: /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/i,
    when: unpinnedImage,
    severity: 'minor',
    category: 'bug',
    confidence: 0.4,
    skill: 'infra/docker/core',
    message:
      'Base image without a pinned tag (or `:latest`): builds are not reproducible and silently pick up breaking or malicious updates.',
    help: 'Pin a version tag, ideally with an @sha256 digest.',
  },
  {
    id: 'docker-user-root',
    languages: ['dockerfile'],
    regex: /^\s*USER\s+(?:root|0)(?::\S+)?\s*$/i,
    when: staysRoot,
    severity: 'minor',
    category: 'security',
    confidence: 0.45,
    cwe: 'CWE-250',
    skill: 'infra/docker/core',
    message:
      'Container runs as root: a compromise of the process gets root inside the container (and more with escapes).',
    help: 'Switch to an unprivileged USER for the final stage.',
  },
  {
    id: 'docker-add-remote',
    languages: ['dockerfile'],
    regex: /^\s*ADD\s+(?:--\S+\s+){0,4}https?:\/\//i,
    notIf: /--checksum=/,
    severity: 'minor',
    category: 'security',
    confidence: 0.4,
    cwe: 'CWE-494',
    skill: 'security/supply-chain',
    message: '`ADD <url>` downloads without integrity verification.',
    help: 'Use ADD --checksum=sha256:… or download and verify in a RUN step.',
  },
  {
    id: 'docker-secret-in-env',
    languages: ['dockerfile'],
    regex:
      /^\s*(?:ENV|ARG)\s+\w*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIALS?)\w*(?:[= ]|$)/i,
    severity: 'major',
    category: 'security',
    confidence: 0.5,
    cwe: 'CWE-538',
    skill: 'infra/docker/core',
    message: 'Secret passed via ENV/ARG is baked into image layers and visible in `docker history`.',
    help: 'Use BuildKit secrets (RUN --mount=type=secret) or inject at runtime.',
  },
];

const WORKFLOW_RULES: PatternRule[] = [
  {
    id: 'gha-script-injection',
    paths: WORKFLOW_PATHS,
    regex: new RegExp(String.raw`\$\{\{\s*${UNTRUSTED_GITHUB_CONTEXT}\s*\}\}`),
    when: inRunBlock,
    severity: 'major',
    category: 'security',
    confidence: 0.65,
    cwe: 'CWE-94',
    skill: 'infra/ci/pipelines',
    message: `Attacker-controlled \`\${{ github.event… }}\` expanded inside a run/script step: shell/JS injection with the workflow's token and secrets.`,
    help: 'Pass the value through `env:` and reference it as "$VAR" in the script.',
  },
  {
    id: 'gha-expression-in-run',
    paths: WORKFLOW_PATHS,
    regex: /\$\{\{\s*(?:github\.event\.|inputs\.|github\.head_ref\b)/,
    notIf: new RegExp(UNTRUSTED_GITHUB_CONTEXT),
    when: inRunBlock,
    severity: 'info',
    category: 'security',
    confidence: 0.3,
    cwe: 'CWE-94',
    skill: 'infra/ci/pipelines',
    message:
      'Event/input data expanded directly into a run/script step: if the value can be influenced externally this is script injection.',
    help: 'Pass the value through `env:` and quote it in the script.',
  },
  {
    id: 'gha-pr-target-checkout',
    paths: WORKFLOW_PATHS,
    regex:
      /\bref\s*:\s*['"]?\$\{\{\s*(?:github\.event\.pull_request\.head\.(?:sha|ref)|github\.head_ref|github\.event\.workflow_run\.head_(?:sha|branch))\s*\}\}|refs\/pull\/\$\{\{/,
    fileIf: /\bpull_request_target\b|\bworkflow_run\s*:/,
    severity: 'critical',
    category: 'security',
    confidence: 0.6,
    cwe: 'CWE-829',
    skill: 'infra/ci/pipelines',
    message:
      'Untrusted PR code checked out in a privileged pull_request_target/workflow_run workflow ("pwn request"): it runs with a write token and secrets.',
    help: 'Use `pull_request` for untrusted code, or never build/run the checked-out head in the privileged job.',
  },
  {
    id: 'gha-unpinned-action',
    paths: WORKFLOW_PATHS,
    regex:
      /^\s*(?:-\s+)?uses\s*:\s*['"]?(?!\.\/|docker:\/\/|actions\/|github\/)[\w.-]+\/[\w./-]+@(?![0-9a-f]{40}\b)[\w.-]+/,
    severity: 'minor',
    category: 'security',
    confidence: 0.3,
    cwe: 'CWE-829',
    skill: 'security/supply-chain',
    message:
      'Third-party action pinned to a mutable tag/branch: a compromised upstream changes the code that runs with your secrets.',
    help: 'Pin to a full commit SHA (keep the tag in a comment).',
  },
  {
    id: 'gha-write-all',
    paths: WORKFLOW_PATHS,
    regex: /^\s*permissions\s*:\s*write-all\b/,
    severity: 'minor',
    category: 'security',
    confidence: 0.45,
    cwe: 'CWE-250',
    skill: 'infra/ci/pipelines',
    message: '`permissions: write-all` gives every step a token that can push code and publish releases.',
    help: 'Grant only the scopes the job needs.',
  },
  {
    id: 'gha-secrets-dump',
    paths: WORKFLOW_PATHS,
    regex: /\$\{\{\s*toJSON\(\s*secrets\s*\)\s*\}\}/i,
    severity: 'major',
    category: 'security',
    confidence: 0.6,
    cwe: 'CWE-200',
    skill: 'infra/ci/pipelines',
    message: '`toJSON(secrets)` exposes every repository secret to the step.',
    help: 'Pass only the specific secrets the step needs.',
  },
];

const CONFIG_RULES: PatternRule[] = [
  {
    id: 'open-cidr',
    languages: [...CONFIG, 'python', ...JS, 'go'],
    regex: /(?:^|[^\d.])(?:0\.0\.0\.0\/0|::\/0)(?![\d/])/,
    when: notEgress,
    severity: 'major',
    category: 'security',
    confidence: 0.4,
    cwe: 'CWE-284',
    skill: 'infra/terraform/core',
    message: 'Ingress open to the whole internet (0.0.0.0/0): the port/service becomes publicly reachable.',
    help: 'Restrict to known CIDR ranges or a load-balancer security group.',
  },
  {
    id: 'k8s-privileged',
    languages: ['yaml', 'json', 'terraform'],
    regex: /\b(?:privileged|allowPrivilegeEscalation|hostNetwork|hostPID|hostIPC)["']?\s*[:=]\s*true\b/,
    severity: 'major',
    category: 'security',
    confidence: 0.5,
    cwe: 'CWE-250',
    skill: 'infra/kubernetes/core',
    message:
      'Privileged container / host namespace access: a container compromise becomes a node compromise.',
    help: 'Drop privileges; grant specific capabilities only if needed.',
  },
];

const SQL_RULES: PatternRule[] = [
  {
    id: 'sql-destructive-change',
    languages: ['sql'],
    regex: /\b(?:DROP\s+(?:TABLE|DATABASE|SCHEMA|COLUMN)|TRUNCATE\s+(?:TABLE\s+)?\w)/i,
    severity: 'major',
    category: 'data-loss',
    confidence: 0.4,
    skill: 'databases/migrations',
    message:
      'Destructive schema change (DROP/TRUNCATE): irreversible data loss if applied without a backup or migration path.',
    help: 'Make sure the data is migrated/backed up and the rollout is backward compatible.',
  },
  {
    id: 'sql-unbounded-write',
    languages: ['sql'],
    regex:
      /\bDELETE\s+FROM\s+[\w."`[\]]{1,120}\s*;|\bUPDATE\s+[\w."`[\]]{1,120}\s+SET\s+(?:(?!\bWHERE\b)[^;]){1,300};/i,
    severity: 'major',
    category: 'data-loss',
    confidence: 0.5,
    skill: 'sql/correctness',
    message: 'UPDATE/DELETE without WHERE modifies every row of the table.',
    help: 'Add the intended WHERE condition.',
  },
  {
    id: 'sql-not-null-without-default',
    languages: ['sql'],
    regex: /\bADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?["`[]?\w+["`\]]?\s+[\w(), ]{1,60}?\bNOT\s+NULL\b/i,
    notIf: /\bDEFAULT\b|\bGENERATED\b/i,
    severity: 'major',
    category: 'bug',
    confidence: 0.45,
    skill: 'databases/migrations',
    message:
      'NOT NULL column added without DEFAULT: the migration fails on tables that already contain rows.',
    help: 'Add a DEFAULT, or add it nullable → backfill → set NOT NULL.',
  },
  {
    id: 'sql-grant-all',
    languages: ['sql'],
    regex: /\bGRANT\s+ALL\b/i,
    severity: 'minor',
    category: 'security',
    confidence: 0.35,
    cwe: 'CWE-250',
    skill: 'sql/correctness',
    message: '`GRANT ALL` gives far more privileges than an application role needs.',
    help: 'Grant only the required privileges.',
  },
];

/** Shell, Dockerfile, GitHub Actions, infrastructure config and SQL rules. */
export const INFRA_RULES: PatternRule[] = [
  ...SHELL_RULES,
  ...DOCKER_RULES,
  ...WORKFLOW_RULES,
  ...CONFIG_RULES,
  ...SQL_RULES,
];
