// Skills catalog: search, group and tier filters over data/skills.json. Opening a skill uses the shared sheet.
import { escapeHtml, loadSkills } from './site.js';

const PAGE = 60;
const root = document.querySelector('[data-catalog]');

const state = { group: '', sub: '', tier: '', q: '', shown: PAGE };

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.group = p.get('group') ?? '';
  state.sub = p.get('sub') ?? '';
  state.tier = p.get('tier') ?? '';
  state.q = p.get('q') ?? '';
}

function writeUrl() {
  const p = new URLSearchParams();
  for (const k of ['group', 'sub', 'tier', 'q']) if (state[k]) p.set(k, state[k]);
  const qs = p.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
}

const top = (id) => id.split('/')[0];
const second = (id) => id.split('/').slice(0, 2).join('/');

// Cross-cutting groups first, then languages by how often they are reviewed, then the rest.
const ORDER = [
  'practice',
  'security',
  'javascript',
  'python',
  'go',
  'java',
  'kotlin',
  'csharp',
  'rust',
  'php',
  'ruby',
  'swift',
  'dart',
  'scala',
  'c-cpp',
  'shell',
  'sql',
  'databases',
  'infra',
  'web',
];
const rank = (group) => {
  const i = ORDER.indexOf(group);
  return i < 0 ? ORDER.length : i;
};

async function main() {
  if (!root) return;
  readUrl();
  let data;
  try {
    data = await loadSkills();
  } catch {
    root.querySelector('[data-results]').innerHTML =
      '<p class="empty">The catalog could not be loaded. Run <code>node scripts/build-website-data.mjs</code> first.</p>';
    return;
  }
  const groupName = new Map(data.groups.map((g) => [g.path, g.name]));
  const search = new Map(
    data.skills.map((s) => [
      s.id,
      [s.name, s.id, s.description, (s.tags ?? []).join(' '), s.body].join('\n').toLowerCase(),
    ]),
  );

  const topCounts = new Map();
  for (const s of data.skills) topCounts.set(top(s.id), (topCounts.get(top(s.id)) ?? 0) + 1);
  const tops = [...topCounts.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const skills = [...data.skills].sort(
    (a, b) => rank(top(a.id)) - rank(top(b.id)) || a.id.localeCompare(b.id),
  );

  const side = root.querySelector('[data-groups]');
  const input = root.querySelector('input[type="search"]');
  const subs = root.querySelector('[data-subgroups]');
  const results = root.querySelector('[data-results]');
  const count = root.querySelector('[data-count]');
  const tierButtons = [...root.querySelectorAll('[data-tier]')];
  input.value = state.q;

  side.innerHTML = [
    ['', 'All skills', data.skills.length],
    ...tops.map((t) => [t, groupName.get(t) ?? t, topCounts.get(t)]),
  ]
    .map(
      ([path, name, n]) =>
        `<li><button type="button" data-group="${escapeHtml(path)}" aria-pressed="false">${escapeHtml(name)}<span>${n}</span></button></li>`,
    )
    .join('');

  const render = () => {
    for (const b of side.querySelectorAll('[data-group]'))
      b.setAttribute('aria-pressed', String(b.dataset.group === state.group));
    for (const b of tierButtons) b.setAttribute('aria-pressed', String(b.dataset.tier === state.tier));

    // second-level groups of the selected technology
    if (state.group) {
      const subCounts = new Map();
      for (const s of data.skills) {
        if (top(s.id) !== state.group || s.id.split('/').length < 3) continue;
        subCounts.set(second(s.id), (subCounts.get(second(s.id)) ?? 0) + 1);
      }
      subs.innerHTML = [...subCounts]
        .sort((a, b) => b[1] - a[1])
        .map(
          ([path, n]) =>
            `<button type="button" data-sub="${escapeHtml(path)}" aria-pressed="${path === state.sub}">${escapeHtml(groupName.get(path) ?? path.split('/')[1])} · ${n}</button>`,
        )
        .join('');
      subs.hidden = subCounts.size === 0;
    } else {
      subs.innerHTML = '';
      subs.hidden = true;
    }

    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = skills.filter(
      (s) =>
        (!state.group || top(s.id) === state.group) &&
        (!state.sub || s.id.startsWith(`${state.sub}/`)) &&
        (!state.tier || s.tier === state.tier) &&
        terms.every((t) => search.get(s.id).includes(t)),
    );
    count.textContent = `${hits.length} skill${hits.length === 1 ? '' : 's'}${state.q ? ` matching “${state.q}”` : ''}`;
    if (!hits.length) {
      results.innerHTML =
        '<p class="empty">No skill matches. Try a library name, a function or a CWE id.</p>';
      return;
    }
    const shown = hits.slice(0, state.shown);
    results.innerHTML = `<ul class="skill-list">${shown
      .map(
        (s) => `<li><button class="skill-row" type="button" data-skill="${escapeHtml(s.id)}">
          <span class="top"><b>${escapeHtml(s.name)}</b>${s.tier === 'full' ? '<span class="badge">full only</span>' : s.alwaysOn ? '<span class="badge badge-ink">always on</span>' : ''}</span>
          <code>${escapeHtml(s.id)}</code>
          <p>${escapeHtml(s.description)}</p>
        </button></li>`,
      )
      .join('')}</ul>${
      hits.length > shown.length
        ? `<div class="load-more"><button class="btn btn-outline" type="button" data-more>Show ${Math.min(PAGE, hits.length - shown.length)} more of ${hits.length - shown.length}</button></div>`
        : ''
    }`;
  };

  root.addEventListener('click', (e) => {
    const g = e.target.closest('[data-group]');
    const sub = e.target.closest('[data-sub]');
    const tier = e.target.closest('[data-tier]');
    if (g) {
      state.group = g.dataset.group;
      state.sub = '';
    } else if (sub) {
      state.sub = state.sub === sub.dataset.sub ? '' : sub.dataset.sub;
    } else if (tier) {
      state.tier = tier.dataset.tier;
    } else if (e.target.closest('[data-more]')) {
      state.shown += PAGE;
      render();
      return;
    } else return;
    state.shown = PAGE;
    writeUrl();
    render();
  });
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.q = input.value.trim();
      state.shown = PAGE;
      writeUrl();
      render();
    }, 120);
  });
  render();
}

main();
