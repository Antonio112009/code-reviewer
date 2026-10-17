// The demo page: a scripted review run typed into a terminal, with the files, the timeline and the pull request alongside.
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const dim = (s) => `<span class="t-dim">${s}</span>`;
const ok = '<span class="t-ok">✔</span>';
const t = (s) => dim(`[${s}]`);

// [delay before the line in ms, html, action?]. Timestamps are the run's own clock; delays are compressed for the page.
const SCRIPT = [
  [0, `${dim('$')} <span class="t-b">code-reviewer review --base main --post</span>`, 'start'],
  [600, `${t('00:00')} › Resolving branches`],
  [300, `${t('00:00')} ${ok} refs        212ms`],
  [100, `${t('00:00')} <span class="t-blue">◆</span> main … HEAD (feature/partial-refunds)  (1 commit)`],
  [200, `${t('00:00')} › Collecting changes`],
  [150, `${t('00:00')} ${ok} collect      24ms`],
  [150, `${t('00:00')} › Detecting technologies`],
  [150, `${t('00:00')} ${ok} stack         9ms`],
  [150, `${t('00:00')} › Running static analyzers`],
  [500, `${t('00:01')} ${ok} analyzers   412ms`],
  [100, `${t('00:01')}   stack     Express · PostgreSQL · Node.js · TypeScript`, 'plan'],
  [
    100,
    `${t('00:01')}   analyzers Secrets (secretlint) <span class="t-ok">✓</span> · Pattern rules <span class="t-ok">✓</span> · Added suppressions <span class="t-ok">✓</span> · ast-grep (skill checks) <span class="t-ok">✓</span>`,
  ],
  [200, `${t('00:01')} › Grouping related files into chunks`],
  [200, `${t('00:01')} ${ok} chunking     31ms`],
  [100, `${t('00:01')}   plan      2 files → 1 chunk · ~1,140 tokens`],
  [100, `${t('00:01')}   models    review claude:sonnet (medium) · critique claude:sonnet (high)`],
  [100, `${t('00:01')}   depth     full — every real defect (≥ info)`],
  [400, `${t('00:01')} › Reviewing 1 chunk`, 'review'],
  [300, `${t('00:01')} [1/1] › c001 src/payments/refunds.ts, src/routes/refunds.ts`],
  [1800, dim('[00:14]   c001 read_file src/routes/refunds.ts'), 'ref'],
  [1400, dim('[00:19]   c001 find_references refund'), 'refs'],
  [
    2200,
    `${t('00:41')} [1/1] ${ok} c001 src/payments/refunds.ts, src/routes/refunds.ts 40s <span class="t-b">2 findings</span> via claude:sonnet skills: practice/general-bugs, security/core, practice/concurrency, javascript/core/async-promises`,
    'flag',
  ],
  [200, `${t('00:41')} ${ok} review        40s  1/1 chunks · 2 raw findings`],
  [300, `${t('00:41')} › Reading the whole change at once`],
  [1800, `${t('00:58')} ${ok} sweep         17s  1 finding · 1 dropped as a duplicate`],
  [200, `${t('00:58')} › Validating 2 raw finding(s)`],
  [150, `${t('00:58')} ${ok} validate      1ms`],
  [300, `${t('00:58')} › Verifying 2 finding(s)`, 'verify'],
  [2200, `${t('01:22')}   critique batch 1/1 done`, 'verified'],
  [200, `${t('01:22')} ${ok} critique      24s  2 findings in 1 batch`],
  [500, '', 'report'],
  [0, '<span class="t-warn">!</span> <span class="t-b">1 major</span>'],
  [0, ''],
  [
    200,
    '  <span class="t-bad">MAJOR</span>     src/payments/refunds.ts:6  <span class="t-b">Concurrent refunds can exceed the order total</span>  conf 0.90 · critic <span class="t-ok">✓</span>',
  ],
  [
    0,
    '            Two refund requests for the same order can both read refunded = 0 and both pass the check, so the',
  ],
  [0, '            customer is refunded up to twice the order total.'],
  [0, ''],
  [
    300,
    dim(
      '  Dropped by the critic (1): refunds.ts:4 “A negative amount is not rejected” — RefundSchema in src/routes/refunds.ts:5 requires amount &gt; 0',
    ),
  ],
  [0, ''],
  [
    300,
    '<span class="t-blue">→</span> One pass misses about a quarter of the real defects a second one finds: re-run with --deepen (~$0.45) for an',
  ],
  [0, '  independent second pass over the 1 chunk; the first pass comes from the cache.'],
  [0, ''],
  [
    200,
    `${dim('Skills')}     practice/general-bugs ×1 · security/core ×1 · practice/concurrency ×1 · javascript/core/async-promises ×1`,
  ],
  [
    0,
    `${dim('Analyzers')}  Secrets (secretlint) <span class="t-ok">✓</span> · Pattern rules <span class="t-ok">✓</span> · Added suppressions <span class="t-ok">✓</span> · ast-grep <span class="t-ok">✓</span>`,
  ],
  [0, `${dim('Timings')}    1m 23s total · review 40s · sweep 17s · critique 24s`],
  [0, `${dim('Tokens')}     in 38,412 (+21,006 cached) · out 3,180 · 6 requests`],
  [0, `${dim('Cost')}       $0.31`],
  [0, `${dim('Run')}        20261017-181204-7c1e (completed) → .code-reviewer/runs/20261017-181204-7c1e`],
  [0, `${dim('Reports')}    report.md · report.json · report.html`],
  [600, `${t('01:24')} › Posting to github.com/acme/shop/pull/214`],
  [900, `${t('01:25')} ${ok} posted        1 inline comment · summary comment created`, 'done'],
  [0, `${dim('$')} `, 'prompt'],
];

const STEPS = ['plan', 'review', 'verify', 'report'];
const DURATIONS = { plan: '1s', review: '57s', verify: '24s', report: '3s' };

function main() {
  const out = document.querySelector('[data-term]');
  const play = document.querySelector('[data-play]');
  const skip = document.querySelector('[data-skip]');
  const status = document.querySelector('[data-status]');
  const after = document.querySelector('[data-after]');
  const steps = [...document.querySelectorAll('[data-steps] li')];
  const tabs = [...document.querySelectorAll('[data-file-tab]')];
  const panes = [...document.querySelectorAll('[data-file-pane]')];
  const notes = {
    finding: document.querySelector('[data-note="finding"]'),
    candidate: document.querySelector('[data-note="candidate"]'),
    ref: document.querySelector('[data-note="ref"]'),
  };
  if (!out) return;

  const showFile = (i) => {
    for (const [j, tab] of tabs.entries()) tab.setAttribute('aria-selected', String(i === j));
    for (const [j, p] of panes.entries()) p.hidden = i !== j;
  };
  for (const [i, tab] of tabs.entries()) tab.addEventListener('click', () => showFile(i));

  let timer;
  let running = false;
  let fast = false;
  let next = () => {};

  const duration = (li, text) => {
    const d = li.querySelector('[data-duration]');
    if (d) d.textContent = text;
  };
  const setStep = (name) => {
    const n = STEPS.indexOf(name);
    steps.forEach((li, i) => {
      li.classList.toggle('now', i === n);
      li.classList.toggle('done', i < n);
      duration(li, i < n ? DURATIONS[STEPS[i]] : '');
    });
  };
  const setNote = (note, state, html) => {
    note.hidden = false;
    note.dataset.state = state;
    const el = note.querySelector('[data-note-state]');
    if (el) el.innerHTML = html;
  };

  const act = (name) => {
    switch (name) {
      case 'start':
        for (const n of Object.values(notes)) n.hidden = true;
        for (const el of document.querySelectorAll('.row.flag, .row.ref')) el.classList.remove('flag', 'ref');
        after.classList.remove('show');
        for (const li of steps) {
          li.classList.remove('now', 'done');
          duration(li, '');
        }
        showFile(0);
        break;
      case 'plan':
      case 'review':
      case 'verify':
      case 'report':
        setStep(name);
        break;
      case 'ref':
        showFile(1);
        for (const el of document.querySelectorAll('[data-ref]')) el.classList.add('ref');
        setNote(notes.ref, 'info', '');
        break;
      case 'refs':
        showFile(0);
        break;
      case 'flag':
        showFile(0);
        for (const el of document.querySelectorAll('[data-flag]')) el.classList.add('flag');
        setNote(notes.finding, 'reported', 'reported · confidence 0.80 · waiting for the critic');
        setNote(notes.candidate, 'reported', 'reported · confidence 0.55 · waiting for the critic');
        break;
      case 'verified':
        setNote(
          notes.finding,
          'confirmed',
          '<b>confirmed</b> · confidence 0.90 · nothing serialises the check and the save',
        );
        setNote(
          notes.candidate,
          'rejected',
          '<b>rejected</b> · RefundSchema in src/routes/refunds.ts:5 already requires amount &gt; 0',
        );
        break;
      case 'done':
        for (const [i, li] of steps.entries()) {
          li.classList.remove('now');
          li.classList.add('done');
          duration(li, DURATIONS[STEPS[i]]);
        }
        after.classList.add('show');
        status.textContent = 'done · 1m 25s · $0.31';
        play.textContent = 'Replay';
        skip.hidden = true;
        running = false;
        break;
      default:
    }
  };

  const run = () => {
    clearTimeout(timer);
    running = true;
    fast = false;
    out.innerHTML = '';
    status.textContent = 'running…';
    play.textContent = 'Restart';
    skip.hidden = false;
    let i = 0;
    next = () => {
      if (i >= SCRIPT.length) return;
      const [delay, html, action] = SCRIPT[i++];
      const go = () => {
        out.querySelector('.cursor')?.remove();
        out.insertAdjacentHTML('beforeend', `${html}${i < SCRIPT.length ? '\n' : ''}`);
        if (action === 'prompt') out.insertAdjacentHTML('beforeend', '<span class="cursor"></span>');
        if (action) act(action);
        out.scrollTop = out.scrollHeight;
        next();
      };
      if (reduced || fast) go();
      else timer = setTimeout(go, Math.round(delay * 0.8));
    };
    next();
  };

  play.addEventListener('click', run);
  skip.addEventListener('click', () => {
    if (!running) return;
    fast = true;
    clearTimeout(timer);
    next();
  });
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting) || running) return;
    io.disconnect();
    run();
  });
  io.observe(out);
}

main();
