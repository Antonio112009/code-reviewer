import { minVersionOfSpec, parseVersion, type Version } from '../../util/versions';

/**
 * Turns what manifests, version files and image tags declare into the lowest version a project is on.
 * Inputs are short, bounded strings; every regex is linear. Nothing is resolved over the network.
 */

/** Longest version spec we accept (anything longer is not a range). */
const MAX_SPEC = 200;
/** Components above this are not versions (hashes, overflow). */
const MAX_COMPONENT = 999_999_999;

function sane(v: Version | undefined): Version | undefined {
  if (!v || v.length === 0 || v.length > 6) return undefined;
  if (v.some((n) => !Number.isFinite(n) || n > MAX_COMPONENT)) return undefined;
  // All-zero versions are placeholders: `0.0.0-experimental-…`, Go `v0.0.0-2024…` pseudo-versions.
  return v.some((n) => n > 0) ? v : undefined;
}

/** The leading version of a plain version string (`v22.11.0`, `3.12.4`, `21-jre`, `1.16.0-x86_64-linux`). */
export function leadingVersion(text: string | undefined): Version | undefined {
  if (typeof text !== 'string') return undefined;
  const s = text.trim();
  return /^v?\d/.test(s) ? sane(parseVersion(s)) : undefined;
}

/**
 * Lowest version a dependency spec allows: `^15.0.3` → 15.0.3, `>=3.10,<4` → 3.10, `~> 7.1` → 7.1,
 * `[8.0,9.0)` → 8.0, `v1.22.3` → 1.22.3, `1.2.3 - 2.0.0` → 1.2.3. Undefined for tags (`latest`), URLs,
 * paths, git refs, GitHub shorthands, `workspace:` / `catalog:` protocols and unresolved build variables
 * (`${kotlin.version}`, `$(EfCoreVersion)`, `$springBootVersion`).
 */
export function specVersion(spec: string | undefined): Version | undefined {
  if (typeof spec !== 'string') return undefined;
  let s = spec.trim();
  if (!s || s.length > MAX_SPEC || /[$#{}\\/]/.test(s)) return undefined;
  const hyphen = /^[v=]?(\d+(?:\.\d+)*)\s+-\s/.exec(s);
  if (hyphen) s = hyphen[1]!;
  // Pre-release / build / platform suffixes (`19.0.0-rc-66855b96-20241106`, `1.0rc2`, `7.1.0.beta1`,
  // `3.3.4.RELEASE`, `v1.2.4-0.2019…`) would otherwise be read as more (higher) lower bounds.
  s = s.replace(/(\d)(?:[-+.]?[A-Za-z]|[-+]\d)[\w.+-]*/g, '$1');
  const min = minVersionOfSpec(s);
  return min === undefined ? undefined : sane(parseVersion(min));
}

/** {@link specVersion} of a dependency; an npm alias counts only when it aliases the same package. */
export function depSpecVersion(name: string, spec: string | undefined): Version | undefined {
  if (typeof spec !== 'string') return undefined;
  const alias = /^npm:((?:@[^/@\s]+\/)?[^@\s/]+)@(.+)$/.exec(spec.trim());
  if (alias) return alias[1] === name ? specVersion(alias[2]) : undefined;
  return specVersion(spec);
}

/** Node.js LTS codenames (github.com/nodejs/Release, CODENAMES.md) → major version. */
const NODE_CODENAMES: Readonly<Record<string, number>> = {
  argon: 4,
  boron: 6,
  carbon: 8,
  dubnium: 10,
  erbium: 12,
  fermium: 14,
  gallium: 16,
  hydrogen: 18,
  iron: 20,
  jod: 22,
  krypton: 24,
  lithium: 26,
};

function codename(name: string): Version | undefined {
  const major = Object.hasOwn(NODE_CODENAMES, name) ? NODE_CODENAMES[name] : undefined;
  return major === undefined ? undefined : [major];
}

/** `.nvmrc` / `.node-version` / `.tool-versions` Node value: `22`, `v22.11.0`, `lts/iron`, `iron`. */
export function nodeVersion(value: string): Version | undefined {
  const s = value.trim().toLowerCase();
  const name = /^(?:lts\/)?([a-z]+)$/.exec(s)?.[1];
  if (name) return codename(name); // `node`, `stable`, `current`, `system` → undefined
  return leadingVersion(s) ?? specVersion(s);
}

/** `.python-version` / `.tool-versions` Python value: `3.12`, `3.12.4`, `cpython@3.12`, `pypy3.10-7.3`, `>=3.12`, `3.13t`. */
export function pythonVersion(value: string): Version | undefined {
  const s = value.trim().replace(/^(?:cpython|pypy|graalpy|python)[@-]?/i, '');
  return leadingVersion(s) ?? specVersion(s);
}

/** Java release as build files write it: `21`, `17.0.2`, `1.8` / `VERSION_1_8` / `1.8.0_292` → 8. */
export function javaVersion(raw: string | undefined): Version | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = leadingVersion(raw.trim().replace(/_/g, '.'));
  if (!v) return undefined;
  return v[0] === 1 && v.length > 1 && v[1]! >= 1 && v[1]! <= 8 ? v.slice(1) : v;
}

/** `temurin-21.0.4+7`, `graalvm-community-21`, `3.24.3-stable` → the version without a vendor prefix. */
export function toolVersion(value: string): Version | undefined {
  return leadingVersion(value.trim().replace(/^(?:[a-z][a-z0-9]*-)+/i, ''));
}

/**
 * .NET version of a target framework moniker: `net8.0`, `net8.0-windows`, `netcoreapp3.1` → modern .NET
 * 8.0 / 3.1; `net48`, `net472` → .NET Framework 4.8 / 4.7.2; `netstandard2.0` (an API set, not a
 * runtime) → undefined.
 */
export function tfmVersion(tfm: string): { version: Version; modern: boolean } | undefined {
  const t = tfm.trim().toLowerCase();
  const modern = /^net(?:coreapp)?(\d{1,2})\.(\d{1,2})/.exec(t);
  if (modern) return { version: [Number(modern[1]), Number(modern[2])], modern: true };
  const fx = /^net(\d)(\d)(\d)?$/.exec(t);
  if (fx) return { version: fx.slice(1).filter(Boolean).map(Number), modern: false };
  return undefined;
}

/** Tag of an image reference (`docker.io/library/node:22-alpine@sha256:…` → `22-alpine`). */
export function imageTag(ref: string): string | undefined {
  let s = ref.trim();
  const at = s.indexOf('@');
  if (at >= 0) s = s.slice(0, at);
  const colon = s.indexOf(':', s.lastIndexOf('/') + 1);
  const tag = colon >= 0 ? s.slice(colon + 1) : '';
  return tag && tag.length <= 128 ? tag : undefined;
}

/** Version in an image tag: `22-alpine` → 22, `3.12.4-slim` → 3.12.4, `jod-alpine` → 22 (Node codenames). */
export function imageTagVersion(
  tag: string,
  opts: { tagPrefix?: RegExp; codenames?: boolean } = {},
): Version | undefined {
  let t = tag.trim().toLowerCase();
  if (opts.tagPrefix) t = t.replace(opts.tagPrefix, '');
  if (opts.codenames) {
    const name = /^([a-z]+)(?:-|$)/.exec(t)?.[1];
    if (name) return codename(name);
  }
  return leadingVersion(t);
}

/**
 * Dockerfile `${VAR}`, `${VAR:-default}`, `${VAR:+alt}` and `$VAR` substitution with the defaults of the
 * `ARG`s declared before the first `FROM` (the only ones a `FROM` line can see). Undefined when a
 * variable has no known value.
 */
export function substituteArgs(ref: string, args: ReadonlyMap<string, string>): string | undefined {
  if (!ref.includes('$')) return ref;
  let unresolved = false;
  const out = ref.replace(
    /\$\{([A-Za-z_]\w{0,63})(?::?([-+])([^}]{0,100}))?\}|\$([A-Za-z_]\w{0,63})/g,
    (
      _m,
      braced: string | undefined,
      op: string | undefined,
      word: string | undefined,
      bare: string | undefined,
    ) => {
      const value = args.get((braced ?? bare)!);
      if (op === '-') return value || (word ?? '');
      if (op === '+') return value ? (word ?? '') : '';
      if (value === undefined) unresolved = true;
      return value ?? '';
    },
  );
  return unresolved ? undefined : out;
}
