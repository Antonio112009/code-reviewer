import { C_FAMILY, CODE, CONFIG, JS, JVM, type PatternRule, TRY_CATCH } from './types';

/** Start of an SQL statement inside a string literal (keyword + the clause that makes it a query). */
const SQL_START = String.raw`(?:SELECT\b[^"'\x60]{0,200}\bFROM|INSERT\s+INTO|UPDATE\s+[\w."\x60[\]]{1,80}\s+SET|DELETE\s+FROM|REPLACE\s+INTO|MERGE\s+INTO)\b`;

/** Rules that apply across many languages. */
export const COMMON_RULES: PatternRule[] = [
  {
    id: 'sql-concatenation',
    languages: [...JS, 'python', ...JVM, 'csharp', 'go', 'ruby', 'rust', 'php', 'dart', 'swift', 'cpp'],
    regex: new RegExp(
      String.raw`["'\x60]\s*${SQL_START}[^"'\x60]{0,300}["'\x60]{1,2}\s*(?:\+|\.\s*\$)\s*[\w$(]`,
      'i',
    ),
    severity: 'major',
    category: 'security',
    confidence: 0.5,
    cwe: 'CWE-89',
    skill: 'security/core',
    message: 'SQL built by string concatenation: SQL injection if any concatenated value is user-controlled.',
    help: 'Use parameter placeholders and pass values separately (prepared statements).',
  },
  {
    id: 'py-sql-format',
    languages: ['python'],
    regex: new RegExp(
      String.raw`\bf["']{1,3}\s*${SQL_START}[^"']{0,300}\{[^}\n]{1,80}\}|["']\s*${SQL_START}[^"']{0,300}["']\s*(?:%\s*[\w(]|\.format\s*\()`,
      'i',
    ),
    severity: 'major',
    category: 'security',
    confidence: 0.5,
    cwe: 'CWE-89',
    skill: 'python/security/injection',
    message: 'SQL built with f-string / % / .format(): values are not parameterized (SQL injection).',
    help: 'Use placeholders (%s / :name) and pass values to execute() separately.',
  },
  {
    id: 'php-sql-interpolation',
    languages: ['php'],
    regex: new RegExp(String.raw`"\s*${SQL_START}[^"]{0,300}(?:\{\$|\$[A-Za-z_])`, 'i'),
    severity: 'major',
    category: 'security',
    confidence: 0.55,
    cwe: 'CWE-89',
    skill: 'php/security/sql',
    message: 'Variables interpolated into an SQL string: SQL injection.',
    help: 'Use PDO/mysqli prepared statements with bound parameters.',
  },
  {
    id: 'cs-sql-interpolation',
    languages: ['csharp'],
    regex: new RegExp(
      String.raw`\$@?"\s*${SQL_START}[^"]{0,300}\{|\b(?:FromSqlRaw|ExecuteSqlRaw(?:Async)?|SqlQueryRaw)\s*\(\s*\$"`,
      'i',
    ),
    severity: 'major',
    category: 'security',
    confidence: 0.55,
    cwe: 'CWE-89',
    skill: 'csharp/data/ado-net',
    message: 'Interpolated string used as SQL: values are not parameterized (SQL injection).',
    help: 'Use SqlParameter / FromSqlInterpolated / ExecuteSqlInterpolated.',
  },
  {
    id: 'jvm-sql-template',
    languages: ['kotlin', 'scala', 'groovy', 'dart'],
    regex: new RegExp(String.raw`"\s*${SQL_START}[^"]{0,300}\$\{?[A-Za-z_]`, 'i'),
    severity: 'major',
    category: 'security',
    confidence: 0.5,
    cwe: 'CWE-89',
    skill: 'security/core',
    message: 'String template used as SQL: values are not parameterized (SQL injection).',
    help: 'Use bind parameters.',
  },
  {
    id: 'weak-password-hash',
    languages: CODE,
    regex:
      /\b(?:md5|sha-?1)\b[^;\n]{0,80}\b(?:password|passwd|pwd)\w*|\b(?:password|passwd|pwd)\w*\b[^;\n]{0,80}\b(?:md5|sha-?1)\b/i,
    severity: 'major',
    category: 'security',
    confidence: 0.55,
    cwe: 'CWE-916',
    skill: 'security/crypto',
    message: 'Password hashed with MD5/SHA-1: fast unsalted hashes are cracked offline in seconds.',
    help: 'Use bcrypt, scrypt or Argon2id.',
  },
  {
    id: 'insecure-random-token',
    languages: [...CODE, ...C_FAMILY],
    regex:
      /\b(?:token|secret|passw(?:or)?d|nonce|salt|otp|csrf|session_?id|api_?key|reset_?(?:code|token)|verification_?code|invite_?code|auth_?code)\w*["']?\s*(?::=|=|:|\()[^\n;]{0,120}?(?:Math\.random\s*\(|\brandom\.(?:random|randint|choice|choices|randrange|getrandbits|sample)\s*\(|\b(?:mt_)?rand\s*\(|\buniqid\s*\(|\brand\.(?:Intn|Int63n?|Int31n?|Int|Read|Perm)\s*\(|\bnew\s+Random\s*\(|\bRandom\.(?:Default\.)?next\w*\s*\()/i,
    notIf:
      /\bsecrets\.|SecureRandom|RandomNumberGenerator|random_bytes|random_int|urandom|SystemRandom|getRandomValues|randomUUID|randomBytes|crypto\/rand/,
    severity: 'major',
    category: 'security',
    confidence: 0.5,
    cwe: 'CWE-338',
    skill: 'security/crypto',
    message: 'Security token generated with a non-cryptographic RNG: values are predictable.',
    help: 'Use a CSPRNG: crypto.randomBytes / secrets.token_urlsafe / crypto/rand / SecureRandom / random_bytes.',
  },
  {
    id: 'jwt-none-algorithm',
    languages: CODE,
    regex: /\balgorithms?["']?\s*[:=]\s*\[?[^\]\n]{0,60}["']none["']/i,
    severity: 'major',
    category: 'security',
    confidence: 0.6,
    cwe: 'CWE-347',
    skill: 'security/auth',
    message: 'JWT "none" algorithm accepted: unsigned tokens pass verification.',
    help: 'Allow only the expected signing algorithms.',
  },
  {
    id: 'cors-wildcard-credentials',
    languages: [...CODE, ...CONFIG],
    regex:
      /Access-Control-Allow-Origin["']?\s*[,:=]\s*["']\*["']|\borigin\s*:\s*(?:["']\*["']|true)\s*[,}]|\ballow_origins\s*=\s*\[\s*["']\*["']|\.AllowAnyOrigin\s*\(\s*\)|\bCORS_(?:ORIGIN_ALLOW_ALL|ALLOW_ALL_ORIGINS)\s*=\s*True|\ballowedOrigins?\s*\(\s*["']\*["']/i,
    fileIf:
      /Allow-Credentials["']?\s*[,:=]\s*["']?true|\bcredentials\s*:\s*true|\bsupports_credentials\s*=\s*True|\ballow_credentials\s*=\s*True|\.AllowCredentials\s*\(\s*\)|CORS_ALLOW_CREDENTIALS\s*=\s*True|allowCredentials\s*\(\s*true\s*\)/i,
    severity: 'major',
    category: 'security',
    confidence: 0.5,
    cwe: 'CWE-942',
    skill: 'web/browser-security/cross-origin',
    message:
      'CORS allows any origin together with credentials: any website can make authenticated requests and read responses.',
    help: 'Reflect only an allowlist of origins when credentials are enabled.',
  },
  {
    id: 'obsolete-tls-version',
    languages: [...CODE, ...CONFIG, 'shell'],
    regex:
      /\b(?:TLSv1(?:_0|_1|\.0|\.1)?|SSLv[23]|PROTOCOL_TLSv1(?:_1)?|PROTOCOL_SSLv[23]|VersionTLS1[01]|VersionSSL30|SslProtocols\.(?:Tls|Tls11|Ssl2|Ssl3))\b(?![._]?[23])/,
    severity: 'minor',
    category: 'security',
    confidence: 0.4,
    cwe: 'CWE-327',
    skill: 'security/crypto',
    message:
      'Obsolete SSL/TLS version (≤ TLS 1.1) enabled: known protocol attacks, rejected by modern peers.',
    help: 'Require TLS 1.2+.',
  },
  {
    id: 'empty-catch',
    languages: TRY_CATCH,
    regex: /\bcatch\s*(?:\([^)]{0,120}\))?\s*\{\s*\}/,
    window: 1,
    severity: 'minor',
    category: 'error-handling',
    confidence: 0.4,
    skill: 'practice/error-handling',
    message: 'Empty catch block swallows the error: failures pass silently and later code runs on bad state.',
    help: 'Handle, log or rethrow; if ignoring is intended, catch the narrowest type and say why.',
  },
  {
    id: 'sensitive-data-logged',
    languages: CODE,
    regex:
      /\b(?:console\.(?:log|info|debug|warn|error)|print(?:ln|f)?|logger?\.\w+|logging\.\w+|log\.\w+|System\.out\.print\w*|fmt\.Print\w*|puts|error_log|var_dump|Log\.\w)\s*\([^\n]{0,160}\b(?:password|passwd|secret|token|api_?key|authorization|credit_?card|card_?number|cvv|ssn)\b/i,
    notIf:
      /\*{3}|redact|mask|\blength\b|\.length|len\(|\bis\s+(?:not\s+)?None|missing|invalid|expired|required|failed|refresh/i,
    severity: 'minor',
    category: 'security',
    confidence: 0.35,
    cwe: 'CWE-532',
    skill: 'practice/logging-privacy',
    message:
      'Credential or sensitive value written to logs: it leaks to log storage and everyone with log access.',
    help: 'Log an identifier or a redacted form instead.',
  },
  {
    id: 'hardcoded-credential',
    languages: [...CODE, ...CONFIG, 'shell', 'dockerfile'],
    regex:
      /\b(?:passw(?:or)?d|secret|api_?key|access_?key|private_?key|client_?secret|auth_?token|access_?token)\w{0,20}["']?\s*(?::=|=>|[:=])\s*["'][^"'\s$%{}<>]{6,120}["']/i,
    notIf:
      /example|sample|dummy|changeme|change_me|placeholder|fake|xxx|\*\*\*|your[_-]|<[a-z_]+>|process\.env|os\.environ|getenv|Getenv|ENV\[|\$\{|\{\{|test|mock|redacted|localhost|["'][\w.-]*(?:password|passwd|secret|token|key)[\w.-]*["']/i,
    severity: 'major',
    category: 'security',
    confidence: 0.35,
    cwe: 'CWE-798',
    skill: 'security/secrets',
    dedupeKey: 'secret',
    message:
      'Credential-like value hard-coded in source: it leaks with the repository and cannot be rotated per environment.',
    help: 'Load it from the environment or a secret manager (and rotate it if it was real).',
  },
];
