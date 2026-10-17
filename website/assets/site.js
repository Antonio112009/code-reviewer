// Shared behaviour of every page: mobile menu, copy buttons, scroll reveals and the skill sheet.
document.documentElement.classList.add('js');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** Inline Markdown of the skill files: `code` and **bold**, everything else escaped. */
export function inlineMarkdown(text) {
  return text
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      i % 2 === 1
        ? `<code>${escapeHtml(part.slice(1, -1))}</code>`
        : escapeHtml(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'),
    )
    .join('');
}

/** A skill body is a bullet list; a bullet may continue on indented lines and start with `[full]`. */
export function skillBullets(body) {
  const items = [];
  for (const line of body.split('\n')) {
    if (line.startsWith('- ')) items.push(line.slice(2));
    else if (line.trim() && items.length) items[items.length - 1] += ` ${line.trim()}`;
  }
  return items.map((text) => {
    const full = text.startsWith('[full] ');
    return { full, text: full ? text.slice(7) : text };
  });
}

let catalog;
export function loadSkills() {
  catalog ??= fetch(new URL('../data/skills.json', import.meta.url)).then((r) => {
    if (!r.ok) throw new Error(`skills.json: ${r.status}`);
    return r.json();
  });
  return catalog;
}

const GITHUB = 'https://github.com/antonio112009/code-reviewer';

function sheetElements() {
  let root = document.querySelector('[data-sheet]');
  if (root) return root;
  root = document.createElement('div');
  root.dataset.sheet = '';
  root.innerHTML = `
    <div class="sheet-backdrop" data-sheet-close></div>
    <aside class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1">
      <header class="sheet-head">
        <div><h2 id="sheet-title"></h2><div class="id"></div></div>
        <button class="btn btn-ghost btn-sm sheet-close" type="button" data-sheet-close aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </header>
      <div class="sheet-body"></div>
      <footer class="sheet-foot"></footer>
    </aside>`;
  document.body.append(root);
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-sheet-close]')) closeSkill();
  });
  return root;
}

let lastFocus;
function onKey(e) {
  if (e.key === 'Escape') closeSkill();
}

export function closeSkill() {
  document.body.classList.remove('sheet-open');
  document.removeEventListener('keydown', onKey);
  if (location.hash.startsWith('#skill='))
    history.replaceState(null, '', location.pathname + location.search);
  lastFocus?.focus?.();
}

function list(items, render) {
  return items?.length ? `<ul class="pattern-list">${items.map(render).join('')}</ul>` : '';
}

export async function openSkill(id) {
  const root = sheetElements();
  const sheet = root.querySelector('.sheet');
  lastFocus = document.activeElement;
  root.querySelector('#sheet-title').textContent = 'Loading…';
  root.querySelector('.id').textContent = id;
  root.querySelector('.sheet-body').innerHTML = '';
  root.querySelector('.sheet-foot').innerHTML = '';
  document.body.classList.add('sheet-open');
  document.addEventListener('keydown', onKey);
  sheet.focus();
  history.replaceState(null, '', `#skill=${encodeURIComponent(id)}`);

  let skill;
  let group;
  try {
    const data = await loadSkills();
    skill = data.skills.find((s) => s.id === id);
    group = data.groups.find(
      (g) => id.startsWith(`${g.path}/`) && !id.slice(g.path.length + 1).includes('/'),
    );
  } catch {
    root.querySelector('#sheet-title').textContent = 'Could not load the skills catalog';
    return;
  }
  if (!skill) {
    root.querySelector('#sheet-title').textContent = 'Skill not found';
    return;
  }

  const bullets = skillBullets(skill.body);
  const a = skill.activation ?? {};
  const versions = Object.entries(a.versions ?? {}).map(([tech, range]) => `${tech} ${range}`);
  root.querySelector('#sheet-title').textContent = skill.name;
  root.querySelector('.sheet-body').innerHTML = `
    <p class="desc">${inlineMarkdown(skill.description)}</p>
    <div class="sheet-meta">
      <span class="badge ${skill.tier === 'essential' ? 'badge-red' : ''}">${skill.tier === 'essential' ? 'essential + full' : 'full depth only'}</span>
      ${skill.alwaysOn ? '<span class="badge badge-ink">always on</span>' : ''}
      ${group ? `<span class="badge">${escapeHtml(group.name)}</span>` : ''}
      ${(skill.tags ?? []).map((t) => `<span class="badge badge-mono">${escapeHtml(t)}</span>`).join('')}
      ${skill.checks ? `<span class="badge badge-blue">${skill.checks} ast-grep check${skill.checks > 1 ? 's' : ''}</span>` : ''}
    </div>
    <h3>What the reviewer is told (${bullets.length} items)</h3>
    <ul class="skill-bullets">${bullets
      .map(
        (b) =>
          `<li>${inlineMarkdown(b.text)}${b.full ? '<span class="badge full-only">full depth</span>' : ''}</li>`,
      )
      .join('')}</ul>
    ${
      a.content?.length || a.files?.length || a.languages?.length || versions.length
        ? `<h3>When it is loaded</h3>
           ${a.languages?.length ? `<p class="muted">Languages: ${a.languages.map(escapeHtml).join(', ')}</p>` : ''}
           ${versions.length ? `<p class="muted">Versions: ${versions.map(escapeHtml).join(', ')}</p>` : ''}
           ${a.content?.length ? '<p class="muted">An added line matches one of:</p>' : ''}
           ${list(a.content, (r) => `<li><code>${escapeHtml(r)}</code></li>`)}
           ${a.files?.length ? '<p class="muted">Or a changed file matches:</p>' : ''}
           ${list(a.files, (r) => `<li><code>${escapeHtml(r)}</code></li>`)}`
        : skill.alwaysOn
          ? '<h3>When it is loaded</h3><p class="muted">On every chunk of every review.</p>'
          : ''
    }
    ${
      skill.sources?.length
        ? `<h3>Sources</h3><ul class="source-list">${skill.sources
            .map(
              (u) =>
                `<li><a href="${escapeHtml(u)}" rel="noopener" target="_blank">${escapeHtml(u)}</a></li>`,
            )
            .join('')}</ul>`
        : ''
    }`;
  const catalogPage = new URL('../skills.html', import.meta.url).pathname;
  root.querySelector('.sheet-foot').innerHTML = `
    <a class="btn btn-outline btn-sm" href="${GITHUB}/blob/main/skills/${encodeURI(id)}.md" target="_blank" rel="noopener">View on GitHub</a>
    ${location.pathname === catalogPage ? '' : `<a class="btn btn-ghost btn-sm" href="${catalogPage}#skill=${encodeURIComponent(id)}">Open in the catalog</a>`}`;
}

/** Accessible tabs: buttons with role=tab and aria-controls inside `root`. Returns the select function. */
export function setupTabs(root) {
  if (!root) return;
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
  const select = (i, focus) => {
    for (const [j, t] of tabs.entries()) {
      t.setAttribute('aria-selected', String(i === j));
      t.tabIndex = i === j ? 0 : -1;
      panels[j].hidden = i !== j;
    }
    if (focus) tabs[i].focus();
  };
  for (const [i, t] of tabs.entries()) t.addEventListener('click', () => select(i));
  root.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    const cur = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    select((cur + step + tabs.length) % tabs.length, true);
  });
  return select;
}

function setupMenu() {
  const header = document.querySelector('.site-header');
  const button = header?.querySelector('.menu-button');
  button?.addEventListener('click', () => {
    const open = header.classList.toggle('open');
    button.setAttribute('aria-expanded', String(open));
  });
}

function setupCopy() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const label = btn.querySelector('.copy-label');
    const text = btn.dataset.copy || btn.closest('.code-block')?.querySelector('pre')?.innerText || '';
    try {
      await navigator.clipboard.writeText(text.replace(/^\$ /gm, ''));
      btn.classList.add('done');
      if (label) label.textContent = 'Copied';
    } catch {
      if (label) label.textContent = 'Press ⌘C';
    }
    setTimeout(() => {
      btn.classList.remove('done');
      if (label) label.textContent = 'Copy';
    }, 1600);
  });
}

function setupReveal() {
  const targets = document.querySelectorAll('.reveal');
  if (reducedMotion || !('IntersectionObserver' in window)) {
    for (const t of targets) t.classList.add('in');
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -6% 0px' },
  );
  for (const t of targets) io.observe(t);
}

function setupSkillLinks() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-skill]');
    if (!el) return;
    e.preventDefault();
    openSkill(el.dataset.skill);
  });
  const m = /^#skill=(.+)$/.exec(location.hash);
  if (m) openSkill(decodeURIComponent(m[1]));
}

setupMenu();
setupCopy();
setupReveal();
setupSkillLinks();
