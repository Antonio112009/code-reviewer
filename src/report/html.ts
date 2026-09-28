import type { RunRecord } from '../types';
import {
  analyzersSummary,
  cacheLabel,
  chunkModelLabel,
  costLabel,
  depthLabel,
  failureAdvice,
  fallbackLabel,
  formatDuration,
  formatNumber,
  rejectedByReason,
  routingLabel,
  severityCounts,
  skillUsage,
  sortFindings,
  stackEntries,
  stripUnsafeChars,
  summaryLine,
  targetLabel,
  tokensLabel,
  toolCallsLabel,
  toolUsage,
} from './common';

// Server-side text goes through `esc`; the findings are embedded as JSON and rendered client-side with
// textContent only, so repository- or model-controlled text can never become markup.

function esc(s: string): string {
  return stripUnsafeChars(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** JSON that is safe to embed inside <script>. */
function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

const STYLE = `
:root{--bg:#f7f7f8;--panel:#fff;--text:#1b1d21;--muted:#62666d;--border:#e3e4e8;--code:#f1f2f4;
--critical:#b42318;--major:#c4520f;--minor:#a37a00;--info:#3a6ea5;--static:#6b4fbb;--ok:#1f7a45;--accent:#4f46e5}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#111214;--panel:#1a1c1f;--text:#e6e7ea;--muted:#9aa0a8;--border:#2c2f34;--code:#22252a;
--critical:#f97066;--major:#fb923c;--minor:#facc15;--info:#7cb3f0;--static:#b69cf5;--ok:#4ade80;--accent:#a5b4fc}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 12px}
code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code);padding:1px 4px;border-radius:4px}
.sub{color:var(--muted);margin-bottom:16px;word-break:break-word}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin:16px 0}
.meta div{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:8px 12px;word-break:break-word}
.meta b{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600}
.summary{font-weight:600;margin:12px 0}
.counts{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
.count{border:1px solid var(--border);border-left:4px solid var(--sev);border-radius:6px;padding:2px 10px;background:var(--panel)}
.controls{position:sticky;top:0;z-index:2;background:var(--bg);display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)}
.controls label{display:flex;gap:6px;align-items:center;cursor:pointer;user-select:none}
.controls input[type=search]{flex:1;min-width:160px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--panel);color:var(--text)}
.card{background:var(--panel);border:1px solid var(--border);border-left:4px solid var(--sev);border-radius:8px;padding:12px 16px;margin:12px 0}
.card.rejected{opacity:.6}
.card.advisory{opacity:.8;border-style:dashed}
.card h3{font-size:15px;margin:0 0 6px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.badge{font-size:11px;font-weight:700;text-transform:uppercase;padding:1px 6px;border-radius:4px;color:#fff;background:var(--sev)}
.badge.static{background:var(--static)}
.facts{color:var(--muted);font-size:13px;display:flex;flex-wrap:wrap;gap:4px 12px;margin-bottom:8px}
.facts a{color:var(--accent)}
.conf{display:inline-flex;align-items:center;gap:6px}.bar{width:60px;height:6px;border-radius:3px;background:var(--border);overflow:hidden;display:inline-block}
.bar i{display:block;height:100%;background:var(--sev)}
.desc{white-space:pre-wrap}
pre{white-space:pre-wrap;word-break:break-word;background:var(--code);border-radius:6px;padding:10px;overflow:auto;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;margin:8px 0}
.critic{border-left:3px solid var(--border);padding-left:10px;color:var(--muted);margin-top:8px}
details summary{cursor:pointer;color:var(--muted)}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--border);border-radius:8px;overflow:hidden;font-size:13px}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--border);vertical-align:top}th{color:var(--muted);font-weight:600;white-space:nowrap}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.empty{color:var(--muted);padding:24px;text-align:center;background:var(--panel);border:1px dashed var(--border);border-radius:8px}
.table-wrap{overflow-x:auto}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.chips li{background:var(--panel);border:1px solid var(--border);border-radius:999px;padding:2px 10px;font-size:13px}
.chips li small{color:var(--muted);margin-left:4px}
.notes li{color:var(--minor)}
.muted{color:var(--muted)}
.st-failed,.st-timeout{color:var(--critical)}.st-ok,.st-done{color:var(--ok)}
`;

const SCRIPT = `
const run = JSON.parse(document.getElementById('run-data').textContent);
const SEV = ['critical','major','minor','info'];
const sevOf = (s) => SEV.includes(s) ? s : 'info';
const state = { sev: new Set(SEV), min: run.options.minConfidence, q: '', rejected: false, advisory: true, onlyStatic: false };
const advisory = run.advisory || [];
const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k === 'style') n.setAttribute('style', v); else n.setAttribute(k, v); }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return n; };
const safeUrl = (u) => (typeof u === 'string' && /^https?:\\/\\//.test(u)) ? u : null;
function card(f, rejected, worth) {
  const loc = f.file + ':' + f.startLine + (f.endLine !== f.startLine ? '-' + f.endLine : '');
  const url = safeUrl(f.author && f.author.lineUrl);
  const isStatic = f.origin === 'static';
  const rule = f.tool ? f.tool.analyzer + '/' + f.tool.ruleId : '';
  const facts = el('div', { class: 'facts' },
    url ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, loc) : el('code', {}, loc),
    el('span', {}, f.category),
    el('span', { class: 'conf' }, el('span', { class: 'bar' }, el('i', { style: 'width:' + Math.round(Math.min(1, Math.max(0, f.confidence)) * 100) + '%' })), 'confidence ' + f.confidence.toFixed(2)),
    f.critique ? el('span', {}, 'critic: ' + f.critique.verdict + ' (reviewer ' + f.critique.originalConfidence.toFixed(2) + ')') : null,
    rule ? el('span', {}, (isStatic ? 'rule ' : 'confirms ') + rule) : null,
    f.author ? el('span', {}, 'author: ' + f.author.name + ' ', safeUrl(f.author.commitUrl) ? el('a', { href: safeUrl(f.author.commitUrl), target: '_blank', rel: 'noopener noreferrer' }, f.author.commit.slice(0, 8)) : f.author.commit.slice(0, 8)) : null,
    f.skills && f.skills.length ? el('span', {}, 'skills: ' + f.skills.join(', ')) : null,
    rejected ? el('span', {}, 'dropped: ' + (f.droppedReason || '')) : null,
    worth ? el('span', {}, 'worth a look: not posted, not gated') : null);
  return el('div', { class: 'card' + (rejected ? ' rejected' : worth ? ' advisory' : ''), style: '--sev: var(--' + sevOf(f.severity) + ')' },
    el('h3', {}, el('span', { class: 'badge' }, sevOf(f.severity)), isStatic ? el('span', { class: 'badge static', title: 'reported by a static analyzer' }, 'static') : null, f.title),
    facts,
    el('div', { class: 'desc' }, f.description),
    f.evidence ? el('pre', {}, f.evidence) : null,
    f.suggestion ? el('div', {}, el('b', {}, 'Suggestion: '), f.suggestion) : null,
    f.critique && f.critique.reason ? el('div', { class: 'critic' }, 'Critic: ' + f.critique.reason) : null);
}
function render() {
  const list = document.getElementById('findings'); list.replaceChildren();
  const q = state.q.toLowerCase();
  const match = (f) => state.sev.has(sevOf(f.severity)) && (!state.onlyStatic || f.origin === 'static') &&
    (!q || (f.file + ' ' + f.title + ' ' + f.description + ' ' + (f.tool ? f.tool.ruleId : '')).toLowerCase().includes(q));
  const shown = run.findings.filter((f) => match(f) && f.confidence >= state.min);
  const rej = state.rejected ? run.rejected.filter(match) : [];
  const worth = state.advisory ? advisory.filter((f) => match(f) && f.confidence >= state.min) : [];
  for (const f of shown) list.append(card(f, false, false));
  for (const f of worth) list.append(card(f, false, true));
  for (const f of rej) list.append(card(f, true, false));
  if (!shown.length && !rej.length && !worth.length) list.append(el('div', { class: 'empty' }, run.findings.length ? 'No findings match the filters.' : 'No defects found above the confidence threshold.'));
  document.getElementById('count').textContent = shown.length + ' of ' + run.findings.length + ' shown';
}
const controls = document.getElementById('controls');
for (const s of SEV) { const cb = el('input', { type: 'checkbox', 'data-sev': s }); cb.checked = true;
  const n = run.findings.filter((f) => sevOf(f.severity) === s).length;
  cb.onchange = () => { cb.checked ? state.sev.add(s) : state.sev.delete(s); render(); };
  controls.append(el('label', { style: '--sev: var(--' + s + ')' }, cb, el('span', { class: 'badge' }, s), el('span', { class: 'muted' }, String(n)))); }
if (run.findings.some((f) => f.origin === 'static')) {
  const st = el('input', { type: 'checkbox' }); st.onchange = () => { state.onlyStatic = st.checked; render(); };
  controls.append(el('label', {}, st, el('span', { class: 'badge static' }, 'static'), 'only'));
}
const slider = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(state.min) });
const sliderLabel = el('span', {}, 'min confidence ' + state.min.toFixed(2));
slider.oninput = () => { state.min = Number(slider.value); sliderLabel.textContent = 'min confidence ' + state.min.toFixed(2); render(); };
controls.append(el('label', {}, slider, sliderLabel));
const rejCb = el('input', { type: 'checkbox' }); rejCb.onchange = () => { state.rejected = rejCb.checked; render(); };
controls.append(el('label', {}, rejCb, 'show rejected (' + run.rejected.length + ')'));
if (advisory.length) {
  const advCb = el('input', { type: 'checkbox' }); advCb.checked = true;
  advCb.onchange = () => { state.advisory = advCb.checked; render(); };
  controls.append(el('label', {}, advCb, 'show worth a look (' + advisory.length + ')'));
}
const search = el('input', { type: 'search', placeholder: 'Filter by file, text or rule…' });
search.oninput = () => { state.q = search.value; render(); };
controls.append(search, el('span', { id: 'count', class: 'sub', style: 'margin:0' }));
render();
`;

function section(title: string, body: string): string {
  return body ? `<h2>${esc(title)}</h2>\n${body}\n` : '';
}

function table(head: string[], rows: string[][], numeric: number[] = []): string {
  const th = head.map((h) => `<th>${esc(h)}</th>`).join('');
  const tr = rows
    .map(
      (r) =>
        `<tr>${r.map((c, i) => `<td${numeric.includes(i) ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

function chips(items: Array<[string, string?]>): string {
  if (!items.length) return '';
  return `<ul class="chips">${items.map(([t, s]) => `<li>${esc(t)}${s ? `<small>${esc(s)}</small>` : ''}</li>`).join('')}</ul>`;
}

function list(items: string[], max: number): string {
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} +${items.length - max}` : shown;
}

function refsSection(run: RunRecord): string {
  const t = run.target;
  const rows: string[] = [];
  if (t.kind === 'diff') {
    rows.push(`<div><b>Base</b><code>${esc(t.base)}</code> ${esc(t.baseSha.slice(0, 12))}</div>`);
    rows.push(`<div><b>Head</b><code>${esc(t.head)}</code> ${esc(t.headSha.slice(0, 12))}</div>`);
    rows.push(`<div><b>Merge-base</b>${esc(t.mergeBase.slice(0, 12))}</div>`);
  }
  const refs = run.refs;
  if (refs) {
    rows.push(
      `<div><b>Base chosen by</b>${esc(refs.baseSource)}${refs.remote ? ` · remote ${esc(refs.remote)}` : ''} · ${refs.fetched ? 'fetched' : 'not fetched'}</div>`,
    );
  }
  if (!rows.length) return '';
  const explanation = refs?.explanation.length
    ? `<ul>${refs.explanation.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
    : '';
  const notes = refs?.notes.length
    ? `<ul class="notes">${refs.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    : '';
  return `<div class="meta">${rows.join('')}</div>${explanation}${notes}`;
}

function analyzersSection(run: RunRecord): string {
  const runs = run.analyzers ?? [];
  if (!runs.length) return '';
  const rows = runs.map((r) => [
    esc(r.label),
    esc(r.tier),
    `<span class="st-${esc(r.status)}">${esc(r.status)}</span>`,
    String(r.hits),
    esc(formatDuration(r.durationMs)),
    esc([r.version ? `v${r.version}` : '', r.reason ?? ''].filter(Boolean).join(' · ')),
  ]);
  return `<p class="muted">${esc(analyzersSummary(runs))}</p>${table(['Analyzer', 'Tier', 'Status', 'Hints', 'Duration', 'Details'], rows, [3, 4])}`;
}

function chunksSection(run: RunRecord): string {
  const rows = run.chunks.map((c) => [
    esc(c.id),
    esc(list(c.files, 6)),
    esc(list(c.contextFiles ?? [], 4)) || '—',
    formatNumber(c.tokens),
    esc(c.skills.join(', ') || '—'),
    String(c.hints ?? 0),
    esc(toolCallsLabel(c.toolCalls, '×', ', ') || '—'),
    esc(chunkModelLabel(c) || '—'),
    esc(formatDuration(c.timeoutMs)),
    esc(formatDuration(c.durationMs)),
    `<span class="st-${esc(c.status)}">${esc(c.status)}</span>${c.cached ? ` (${c.cached === 'all' ? 'cached' : 'partly cached'})` : ''}${c.failure ? ` (${esc(c.failure)})` : ''}${c.error ? `: ${esc(c.error.split('\n')[0]!.slice(0, 200))}` : ''}${(c.recovery ?? []).map((r) => `<br><span class="muted">↻ ${esc(r)}</span>`).join('')}`,
    String(c.findings),
  ]);
  return table(
    [
      'Chunk',
      'Files',
      'Context files',
      'Tokens',
      'Skills',
      'Hints',
      'Tool calls',
      'Model',
      'Timeout',
      'Duration',
      'Status',
      'Findings',
    ],
    rows,
    [3, 5, 8, 9, 11],
  );
}

/** Self-contained interactive HTML report (no external resources). */
export function renderHtml(run: RunRecord): string {
  const sorted = {
    ...run,
    findings: sortFindings(run.findings),
    ...(run.advisory ? { advisory: sortFindings(run.advisory) } : {}),
    rejected: sortFindings(run.rejected),
  };
  const failedChunks = run.chunks.filter((c) => c.status === 'failed');
  const failed = failedChunks.length;
  const cost = costLabel(run);
  const meta: Array<[string, string]> = [
    ['Status', run.status],
    ['Created', run.createdAt],
    ['Review model', routingLabel(run, 'review') ?? '—'],
    ...(run.options.selfCritique
      ? ([['Critique model', routingLabel(run, 'critique') ?? '—']] as Array<[string, string]>)
      : []),
    ['Duration', formatDuration(run.durationMs)],
    ['Tokens', tokensLabel(run)],
    ...(cost ? ([['Cost', cost]] as Array<[string, string]>) : []),
    ...(cacheLabel(run) ? ([['Cache', cacheLabel(run)!]] as Array<[string, string]>) : []),
    ['Chunks', `${run.chunks.length}${failed ? ` (${failed} failed)` : ''}`],
    ['Depth', depthLabel(run)],
    ['Min confidence', String(run.options.minConfidence)],
  ];
  const counts = severityCounts(run.findings);
  const countChips = (Object.keys(counts) as Array<keyof typeof counts>)
    .map((s) => `<span class="count" style="--sev: var(--${s})"><b>${counts[s]}</b> ${s}</span>`)
    .join('');
  const rejected = rejectedByReason(run);
  const stack = stackEntries(run.stack);
  const skills = skillUsage(run);
  const tools = toolUsage(run);
  const warnings = run.warnings.length
    ? `<ul>${run.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
    : '';
  const fallbacks = run.fallbacks?.length
    ? `<ul>${run.fallbacks.map((f) => `<li>${esc(fallbackLabel(f))}</li>`).join('')}</ul>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>Code review ${esc(run.id)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Code review</h1>
<div class="sub">${esc(targetLabel(run))} · run <code>${esc(run.id)}</code></div>
<div class="meta">${meta.map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`).join('')}</div>
<div class="summary">${esc(summaryLine(run))}</div>
<div class="counts">${countChips}</div>
${run.error ? `<p class="st-failed">${esc(run.error)}</p>` : ''}
${failed ? `<div class="st-failed"><b>Not reviewed:</b> ${failed} of ${run.chunks.length} chunks failed.<ul>${failedChunks.map((c) => `<li><code>${esc(c.id)}</code> (${esc(list(c.files, 4))}): ${esc(failureAdvice(c.failure))}</li>`).join('')}</ul></div>` : ''}
${run.summary ? `<p>${esc(run.summary)}</p>` : ''}
<h2>Findings</h2>
<div class="controls" id="controls"></div>
<div id="findings"></div>
${section('Rejected', rejected.length ? `<p class="muted">${esc(rejected.map((r) => `${r.count} ${r.label}`).join(' · '))} — tick “show rejected” above to list them.</p>` : '')}
${section('Refs', refsSection(run))}
${section('Detected stack', chips(stack.map((t) => [t.name, `${t.category} · ${t.score.toFixed(2)}`])))}
${section('Static analysis', analyzersSection(run))}
${section('Skills used', chips(skills.map((s) => [s.id, `×${s.chunks}`])))}
${section('Tool usage', chips(tools.map((t) => [t.tool, `×${t.calls}`])))}
${section('Model fallbacks', fallbacks)}
${section('Chunks', chunksSection(run))}
${section('Warnings', warnings)}
</main>
<script type="application/json" id="run-data">${embedJson(sorted)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
