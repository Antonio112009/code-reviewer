// Small SVG charts: horizontal bars and a scatter plot, each with a hover tooltip and a table view.
import { COLORS, KIND_LABEL } from './bench-data.js';
import { escapeHtml } from './site.js';

const NS = 'http://www.w3.org/2000/svg';
const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function tooltip(host) {
  let tip = host.querySelector('.chart-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    tip.setAttribute('role', 'status');
    host.append(tip);
  }
  return {
    show(html, x, y) {
      tip.innerHTML = html;
      tip.classList.add('show');
      const w = tip.offsetWidth;
      const left = Math.min(Math.max(0, x - w / 2), host.clientWidth - w);
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(0, y - tip.offsetHeight - 12)}px`;
    },
    hide() {
      tip.classList.remove('show');
    },
  };
}

function rows(pairs) {
  return pairs.map(([k, v]) => `<span class="row"><span>${k}</span><b>${v}</b></span>`).join('');
}

function legend(kinds) {
  return `<ul class="chart-legend">${kinds
    .map((k) => `<li><i style="background:${COLORS[k]}"></i>${KIND_LABEL[k]}</li>`)
    .join('')}</ul>`;
}

/** Rounded data end, square at the baseline. */
function barPath(x, y, w, h, r = 4) {
  if (w <= r) return `M${x},${y}h${w}v${h}h${-w}z`;
  return `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - r)}z`;
}

/**
 * Horizontal bars. items: { label, value, kind?, tip: [[k, v], …] }.
 * opts: { max, unit, legend: kinds[] | false, color }
 */
export function barChart(host, items, opts = {}) {
  const draw = () => {
    const width = Math.max(300, host.clientWidth);
    const narrow = width < 520;
    const labelW = narrow ? 0 : Math.min(250, width * 0.4);
    const rowH = narrow ? 52 : 36;
    const barH = 18;
    const top = 6;
    const valueW = 46;
    const plotW = width - labelW - valueW;
    const max = opts.max ?? 100;
    const height = top + items.length * rowH + 24;
    const x = (v) => labelW + (v / max) * plotW;
    const ticks = [];
    for (let t = 0; t <= max; t += opts.step ?? 20) ticks.push(t);

    let svg = `<svg xmlns="${NS}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(opts.title ?? '')}">`;
    svg += '<g class="grid">';
    for (const t of ticks) svg += `<line x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${height - 22}"/>`;
    svg += '</g><g class="axis">';
    for (const t of ticks)
      svg += `<text x="${x(t)}" y="${height - 6}" text-anchor="middle">${t}${opts.unit ?? ''}</text>`;
    svg += '</g>';
    items.forEach((it, i) => {
      const y0 = top + i * rowH;
      const by = narrow ? y0 + 22 : y0 + (rowH - barH) / 2;
      const color = opts.color ?? COLORS[it.kind ?? 'ours'];
      const lx = narrow ? labelW : labelW - 12;
      const ly = narrow ? y0 + 14 : by + barH / 2 + 4.5;
      svg += `<g class="mark" data-i="${i}">`;
      svg += `<text class="label${it.kind === 'ours' ? ' label-ours' : ''}" x="${lx}" y="${ly}" text-anchor="${narrow ? 'start' : 'end'}">${escapeHtml(it.label)}</text>`;
      svg += `<path d="${barPath(labelW, by, Math.max(2, x(it.value) - labelW), barH)}" fill="${color}"/>`;
      svg += `<text class="value" x="${x(it.value) + 8}" y="${by + barH / 2 + 4.5}">${fmt(it.value)}${opts.unit ?? ''}</text>`;
      svg += `<rect class="hit" x="0" y="${y0}" width="${width}" height="${rowH}"/>`;
      svg += '</g>';
    });
    svg += '</svg>';
    host.innerHTML = svg + (opts.legend ? legend(opts.legend) : '');
    bindHover(host, (i, e) => {
      const it = items[i];
      const r = host.getBoundingClientRect();
      return {
        html: `<b>${escapeHtml(it.label)}</b>${rows(it.tip ?? [])}`,
        x: e.clientX - r.left,
        y: e.clientY - r.top,
      };
    });
  };
  draw();
  observe(host, draw);
}

/**
 * Scatter of precision (y) against recall (x). points: { label, x, y, kind, place: 'right'|'left'|'above'|'below' }.
 */
export function scatterChart(host, points, opts = {}) {
  const draw = () => {
    const width = Math.max(300, host.clientWidth);
    const height = Math.round(Math.min(460, Math.max(300, width * 0.62)));
    const m = { l: 46, r: 16, t: 12, b: 42 };
    const [x0, x1] = opts.x ?? [30, 80];
    const [y0, y1] = opts.y ?? [30, 80];
    const sx = (v) => m.l + ((v - x0) / (x1 - x0)) * (width - m.l - m.r);
    const sy = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (height - m.t - m.b);
    let svg = `<svg xmlns="${NS}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(opts.title ?? '')}">`;
    svg += '<g class="grid">';
    for (let t = x0; t <= x1; t += 10)
      svg += `<line x1="${sx(t)}" x2="${sx(t)}" y1="${m.t}" y2="${height - m.b}"/>`;
    for (let t = y0; t <= y1; t += 10)
      svg += `<line x1="${m.l}" x2="${width - m.r}" y1="${sy(t)}" y2="${sy(t)}"/>`;
    svg += '</g><g class="axis">';
    for (let t = x0; t <= x1; t += 10)
      svg += `<text x="${sx(t)}" y="${height - m.b + 18}" text-anchor="middle">${t}%</text>`;
    for (let t = y0; t <= y1; t += 10)
      svg += `<text x="${m.l - 8}" y="${sy(t) + 4}" text-anchor="end">${t}%</text>`;
    svg += `<text x="${(m.l + width - m.r) / 2}" y="${height - 4}" text-anchor="middle">Recall: share of the known bugs found →</text>`;
    svg += `<text transform="translate(12 ${(m.t + height - m.b) / 2}) rotate(-90)" text-anchor="middle">Precision →</text>`;
    svg += '</g>';
    const narrow = width < 520;
    points.forEach((p, i) => {
      const cx = sx(p.x);
      const cy = sy(p.y);
      const place = p.place ?? 'right';
      const dx = place === 'left' ? -12 : place === 'right' ? 12 : 0;
      const dy = place === 'above' ? -13 : place === 'below' ? 20 : 4.5;
      const anchor = place === 'left' ? 'end' : place === 'right' ? 'start' : 'middle';
      const show = !narrow || p.kind !== 'other' || p.always;
      svg += `<g class="mark" data-i="${i}">`;
      svg += `<circle cx="${cx}" cy="${cy}" r="${p.kind === 'other' ? 6 : 7}" fill="${COLORS[p.kind]}" stroke="var(--surface)" stroke-width="2"/>`;
      if (show)
        svg += `<text class="label${p.kind === 'ours' ? ' label-ours' : ''}" x="${cx + dx}" y="${cy + dy}" text-anchor="${anchor}">${escapeHtml(p.short ?? p.label)}</text>`;
      svg += `<circle class="hit" cx="${cx}" cy="${cy}" r="16"/>`;
      svg += '</g>';
    });
    svg += '</svg>';
    host.innerHTML = svg + legend(['ours', 'plain', 'other']);
    bindHover(host, (i) => {
      const p = points[i];
      return {
        html: `<b>${escapeHtml(p.label)}</b>${rows([
          ['Precision', `${fmt(p.y)}%`],
          ['Recall', `${fmt(p.x)}%`],
          ['F1', `${fmt(p.f1)}`],
        ])}${p.note ? `<span class="muted">${escapeHtml(p.note)}</span>` : ''}`,
        x: sx(p.x),
        y: sy(p.y),
      };
    });
  };
  draw();
  observe(host, draw);
}

function bindHover(host, describe) {
  const tip = tooltip(host);
  const svg = host.querySelector('svg');
  const marks = [...svg.querySelectorAll('.mark')];
  const clear = () => {
    host.classList.remove('hovering');
    for (const m of marks) m.classList.remove('active');
    tip.hide();
  };
  for (const mark of marks) {
    mark.addEventListener('pointermove', (e) => {
      host.classList.add('hovering');
      for (const m of marks) m.classList.toggle('active', m === mark);
      const d = describe(Number(mark.dataset.i), e);
      tip.show(d.html, d.x, d.y);
    });
    mark.addEventListener('pointerleave', clear);
  }
}

/** Redraws once per animation frame while the host is being resized. */
function observe(host, draw) {
  let w = host.clientWidth;
  let frame = 0;
  new ResizeObserver(() => {
    if (frame || Math.abs(host.clientWidth - w) < 8) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      w = host.clientWidth;
      draw();
    });
  }).observe(host);
}

/** A table view of the same rows, for screen readers and anyone who prefers numbers. */
export function tableView(host, head, body, oursRows = []) {
  const details = document.createElement('details');
  details.className = 'chart-table';
  details.innerHTML = `<summary>Show as a table</summary><div class="table-scroll"><table class="data-table"><thead><tr>${head
    .map((h) => `<th scope="col">${h}</th>`)
    .join('')}</tr></thead><tbody>${body
    .map(
      (r, i) =>
        `<tr${oursRows.includes(i) ? ' class="ours"' : ''}>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`,
    )
    .join('')}</tbody></table></div>`;
  host.after(details);
}
