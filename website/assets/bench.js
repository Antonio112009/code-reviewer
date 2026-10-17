// Benchmarks page: F1 bars, precision against recall, the pipeline against the plain model, and the audits.
import { audit, COLORS, depths, martian, martianPosted } from './bench-data.js';
import { barChart, scatterChart, tableView } from './charts.js';

const pct = (v) => `${v}%`;

function f1() {
  const host = document.querySelector('[data-chart="f1"]');
  const items = [...martian]
    .sort((a, b) => b.f1 - a.f1)
    .map((m) => ({
      label: m.label,
      value: m.f1,
      kind: m.kind,
      tip: [
        ['Precision', pct(m.p)],
        ['Recall', pct(m.r)],
        ['Findings per PR', m.perPr],
        ...(m.cost ? [['Cost per PR', `$${m.cost.toFixed(2)}`]] : []),
      ],
    }));
  barChart(host, items, {
    max: 70,
    step: 10,
    legend: ['ours', 'plain', 'other'],
    title: 'F1 on Martian Code Review Bench',
  });
  tableView(
    host,
    ['Reviewer', 'Findings / PR', 'Precision', 'Recall', 'F1'],
    [...martian].sort((a, b) => b.f1 - a.f1).map((m) => [m.label, m.perPr, pct(m.p), pct(m.r), m.f1]),
    [...martian].sort((a, b) => b.f1 - a.f1).flatMap((m, i) => (m.kind === 'ours' ? [i] : [])),
  );
}

function scatter() {
  const host = document.querySelector('[data-chart="pr"]');
  const place = {
    Augment: 'above',
    'Qodo Extended': 'right',
    'Code Reviewer': 'below',
    'Code Reviewer 0.7.0': 'right',
    'Qodo v2': 'below',
    'One call': 'left',
    'Claude Code CLI': 'right',
    'Code Reviewer, posted': 'right',
  };
  const points = [...martian, martianPosted].map((m) => ({
    label: m.label,
    short: m.short,
    x: m.r,
    y: m.p,
    f1: m.f1,
    kind: m.kind,
    note: m.note,
    place: place[m.short],
    always: m.short === 'Augment' || m.short === 'Qodo Extended',
  }));
  scatterChart(host, points, {
    x: [35, 75],
    y: [35, 75],
    title: 'Precision against recall on Martian Code Review Bench',
  });
}

function plainVsPipeline() {
  const host = document.querySelector('[data-chart="plain"]');
  const ours = martian.find((m) => m.short === 'Code Reviewer');
  const plain = martian.find((m) => m.kind === 'plain');
  const items = [];
  for (const [key, name] of [
    ['p', 'Precision'],
    ['r', 'Recall'],
    ['f1', 'F1'],
  ]) {
    items.push({
      label: `${name}, Code Reviewer`,
      value: ours[key],
      kind: 'ours',
      tip: [[name, `${ours[key]}`]],
    });
    items.push({
      label: `${name}, one call`,
      value: plain[key],
      kind: 'plain',
      tip: [[name, `${plain[key]}`]],
    });
  }
  barChart(host, items, {
    max: 80,
    step: 20,
    legend: ['ours', 'plain'],
    title: 'Code Reviewer against its own model in one call',
  });
}

function audits() {
  const host = document.querySelector('[data-chart="audit"]');
  barChart(
    host,
    audit.map((a) => ({
      label: a.label,
      value: a.value,
      tip: [
        ['Real defects', pct(a.value)],
        ['', a.detail],
      ],
    })),
    {
      max: 100,
      step: 25,
      unit: '%',
      color: COLORS.ours,
      title: 'Share of findings judged real in blind audits',
    },
  );
}

function depthTable() {
  const body = document.querySelector('[data-depths]');
  body.innerHTML = depths
    .map(
      (d) =>
        `<tr${d.label.startsWith('full') ? ' class="ours"' : ''}><td><code>${d.label}</code></td><td>${d.findings}</td><td>${d.precision}%</td><td>${d.recall}%</td><td>${d.defects}%</td><td>$${d.cost.toFixed(1)}</td></tr>`,
    )
    .join('');
}

f1();
scatter();
plainVsPipeline();
audits();
depthTable();
