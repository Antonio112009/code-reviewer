// Home page: the step-by-step review replay and the benchmark teaser chart.
import { martian } from './bench-data.js';
import { barChart, tableView } from './charts.js';
import { setupTabs } from './site.js';

const STEP_MS = 6500;

function replay() {
  const root = document.querySelector('[data-replay]');
  if (!root) return;
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
  const progress = root.querySelector('.replay-progress');
  progress.style.setProperty('--step-ms', `${STEP_MS}ms`);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let current = 0;
  let timer;
  let auto = !reduced;

  const select = (i, focus = false) => {
    current = i;
    tabs.forEach((t, j) => {
      t.setAttribute('aria-selected', String(j === i));
      t.tabIndex = j === i ? 0 : -1;
      panels[j].hidden = j !== i;
    });
    if (focus) tabs[i].focus();
    progress.classList.remove('run');
    if (auto) {
      void progress.offsetWidth; // restart the progress animation
      progress.classList.add('run');
      clearTimeout(timer);
      timer = setTimeout(() => select((current + 1) % tabs.length), STEP_MS);
    }
  };
  const stop = () => {
    auto = false;
    clearTimeout(timer);
    progress.classList.remove('run');
  };

  for (const [i, t] of tabs.entries()) {
    t.addEventListener('click', () => {
      stop();
      select(i);
    });
  }
  root.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    stop();
    select((current + step + tabs.length) % tabs.length, true);
  });
  root.addEventListener('pointerenter', () => {
    if (auto) clearTimeout(timer);
    progress.style.animationPlayState = 'paused';
    progress.querySelector('i').style.animationPlayState = 'paused';
  });
  root.addEventListener('pointerleave', () => {
    progress.querySelector('i').style.animationPlayState = '';
    if (auto) select(current);
  });

  // start once the card is on screen
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    select(0);
  });
  io.observe(root);
}

function f1Chart() {
  const host = document.querySelector('[data-chart="f1"]');
  if (!host) return;
  const items = [...martian]
    .sort((a, b) => b.f1 - a.f1)
    .map((m) => ({
      label: m.label,
      value: m.f1,
      kind: m.kind,
      tip: [
        ['Precision', `${m.p}%`],
        ['Recall', `${m.r}%`],
        ['Findings per PR', m.perPr],
        ...(m.note ? [['Build', m.note]] : []),
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
    ['Reviewer', 'Precision', 'Recall', 'F1'],
    items.map((it) => [it.label, it.tip[0][1], it.tip[1][1], it.value]),
    items.flatMap((it, i) => (it.kind === 'ours' ? [i] : [])),
  );
}

replay();
f1Chart();
setupTabs(document.querySelector('[data-tabs]'));
