/*
 * Quiet Lattice — interface.
 *
 * Everything on screen is redrawn from three things: the current view (a
 * level, the trial or the sandbox), the rule being edited, and the running
 * simulation. Progress is kept in localStorage; the game works without it.
 */
(function () {
  'use strict';

  const QL = window.QL;
  const levels = QL.levels;
  const par = QL.par || null;
  const coachScripts = QL.coach || {};
  const STORE_KEY = 'quiet-lattice/1';
  const $ = function (id) { return document.getElementById(id); };

  const TRIAL = {
    id: 'trial',
    name: 'Trial',
    allow: { signals: 4, coin: true, clear: true, cards: 16 },
    brief: [
      'No target here. Every edge fails with probability p, then the rule runs until the lattice is quiet or time runs out. A lattice fails if defects remain or the loop winds around the torus.',
      'Below a threshold, larger lattices fail less. Above it they fail more. Thin lines are the house rule, the best one the authors know.',
    ],
  };
  const SANDBOX = {
    id: 'sandbox',
    name: 'Sandbox',
    allow: { signals: 4, coin: true, clear: true, cards: 16 },
    brief: [
      'Click an edge to flip it. Scatter random errors, or let noise keep falling while the rule works.',
    ],
  };
  const views = levels.concat([TRIAL, SANDBOX]);

  const SPEEDS = [['slow', 3], ['steady', 9], ['fast', 30]];
  const SCHEDULE_NAMES = {
    sync: 'all at once', raster: 'row by row', reverse: 'backwards',
    columns: 'column by column', shuffle: 'shuffled', random: 'random',
  };
  const ARROWS = { E: '→', S: '↓', W: '←', N: '↑' };
  const DIR_NAMES = { E: 'east', S: 'south', W: 'west', N: 'north', here: 'here' };
  const TURN_NAMES = { none: 'none', all: '4-fold', 'all+signals': '4-fold + signals' };
  const TURN_TIPS = {
    none: 'the circuit works only the way it is built',
    all: 'the circuit also works turned to face the other three directions',
    'all+signals': '4-fold, and each turned copy uses the next signal: a, b, c, d',
  };

  // ---------------------------------------------------------------- store

  function defaults() {
    return {
      rules: {}, solved: {}, coach: {}, view: levels[0].id, speed: 9, copies: true,
      board: {}, borrowed: {}, player: null, note: null,
      sandbox: { L: 12, p: 0.04, noise: 0, schedule: 'sync' },
      trial: { schedule: 'sync', samples: 200 },
    };
  }

  let store = defaults();
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      store = Object.assign(defaults(), saved);
      store.sandbox = Object.assign(defaults().sandbox, saved.sandbox);
      store.trial = Object.assign(defaults().trial, saved.trial);
    }
  } catch (err) { store = defaults(); }

  function save() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (err) { /* private mode */ }
  }

  // the text above the bench: folded or not, and what of it has been read on each level
  if (!store.note || typeof store.note !== 'object') {
    // a save from before the text could fold: what was on screen then counts as read
    store.note = { open: true, seen: {} };
    views.forEach(function (v) {
      const script = coachScripts[v.id];
      if (!script) { if (store.rules[v.id]) store.note.seen[v.id] = 'brief'; return; }
      const at = store.coach[v.id] != null ? store.coach[v.id] : (store.solved[v.id] ? script.steps.length - 1 : null);
      if (at != null) store.note.seen[v.id] = 'step ' + Math.min(at, script.steps.length - 1);
    });
  }
  if (!store.note.seen || typeof store.note.seen !== 'object') store.note.seen = {};
  store.note.open = store.note.open !== false;

  // who this browser is on the leaderboards: a random name made here, never asked for
  if (!store.board || typeof store.board !== 'object') store.board = {};
  if (!store.borrowed || typeof store.borrowed !== 'object') store.borrowed = {};
  if (!store.player || !/^[0-9a-f]{16}$/.test(store.player.id || '')) {
    store.player = { id: QL.ladder.newId() };
    save();
  }

  // ---------------------------------------------------------------- state

  let view = null;
  let rule = [];
  let prog = null;
  let compileError = null;
  let verdict = null;
  let judgeTimer = 0;
  let theme = null;
  let boardSize = 480;
  let sandboxErrors = null;

  const sim = {
    lat: null, random: null, running: false, result: null,
    caseIndex: 0, runIndex: 0, schedule: 'sync', noise: 0, maxTicks: 0,
    last: 0, acc: 0, raf: 0,
  };

  const trial = { token: 0, running: false, data: null, stale: false, hover: -1 };

  // the changes made to each view's machine in this visit, for undo and redo
  const histories = {};

  // the guided steps of the current level, if it has any
  const coach = { script: null, index: 0, entryDone: true, entryCards: 0, shown: '' };

  function isLevel() { return view !== TRIAL && view !== SANDBOX; }
  function allowedSignals() { return view.allow.signals == null ? 4 : view.allow.signals; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function esc(text) {
    return String(text).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  /** A level starts from the rule of the level before it. */
  function starterRule(target) {
    const index = views.indexOf(target);
    const script = coachScripts[target.id];
    for (let k = index - 1; k >= 0; k--) {
      const earlier = store.rules[views[k].id];
      // a guided level's text assumes the level before it was solved
      if (earlier && earlier.length && (!script || store.solved[views[k].id])) return clone(earlier);
      if (script) break;
    }
    if (script && script.start) return clone(script.start);
    return [{ when: {}, coin: null, then: 'move:E', turn: 'none' }];
  }

  // ----------------------------------------------------------------- views

  function setView(id) {
    view = views.find(function (v) { return v.id === id; }) || views[0];
    store.view = view.id;
    if (!store.rules[view.id]) store.rules[view.id] = starterRule(view);
    rule = store.rules[view.id];
    coach.script = isLevel() ? coachScripts[view.id] || null : null;
    coach.index = 0;
    if (coach.script) {
      const lastStep = coach.script.steps.length - 1;
      // a level solved before it had a guide opens on the guide's last step
      const saved = store.coach[view.id];
      coach.index = Math.min(saved == null ? (store.solved[view.id] ? lastStep : 0) : saved, lastStep);
    }
    coach.entryDone = true;               // no step advances while the view is being set up
    selected = 0;
    tool = 'probe';
    // changes made here can be stepped back through; a machine that changed behind its back starts afresh
    const written = JSON.stringify(rule);
    if (!histories[view.id] || histories[view.id].current() !== written) {
      histories[view.id] = QL.bench.history(200);
      histories[view.id].reset(written);
    }
    sim.caseIndex = 0;
    sim.runIndex = 0;
    trial.token++;
    trial.running = false;
    trial.data = null;
    trial.stale = false;
    renderNav();
    renderSide();
    layoutStage();
    onRuleChanged(true);
    if (coach.script) enterCoachStep(coach.index); else renderCoach();
  }

  function renderNav() {
    const nav = $('nav');
    nav.innerHTML = '';
    views.forEach(function (v, k) {
      if (v === TRIAL) {
        const gap = document.createElement('span');
        gap.className = 'gap';
        nav.appendChild(gap);
      }
      const b = document.createElement('button');
      b.type = 'button';
      const level = k < levels.length;
      b.textContent = level ? String(k + 1) : v.name;
      b.className = (level ? 'num' : '') + (store.solved[v.id] ? ' solved' : '');
      b.title = v.name + (store.solved[v.id] ? ' (solved)' : '');
      b.setAttribute('aria-label', (level ? 'Level ' + (k + 1) + ', ' : '') + v.name
        + (store.solved[v.id] ? ', solved' : ''));
      b.setAttribute('aria-current', String(v === view));
      b.addEventListener('click', function () { setView(v.id); });
      nav.appendChild(b);
    });
  }

  function renderSide() {
    const index = levels.indexOf(view);
    $('title').textContent = view.name;
    let html = view.brief.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
    if (view.hint) html += '<p class="hint">' + esc(view.hint) + '</p>';
    $('brief').innerHTML = html;
    $('brief').hidden = !!coach.script;

    let goal = '';
    if (isLevel()) {
      const only = view.cases.length === 1 && view.cases[0].random;
      goal = only
        ? 'at least ' + only.need + ' of the ' + only.samples + ' random lattices must end quiet.'
        : 'clear every pattern under the lattice' + (view.schedules ? ', in every update order' : '')
          + (view.dark ? ', and leave no signal lit' : '') + '.';
    }
    $('goal').innerHTML = goal ? '<span class="label">Goal</span> ' + esc(goal) : '';
    $('goal').hidden = !goal;

    const parts = [];
    const n = allowedSignals();
    parts.push(n === 0 ? 'no signals' : n === 4 ? 'four signals' : plural(n, 'signal'));
    if (view.allow.clear) parts.push('absorber');
    if (view.allow.coin) parts.push('coin');
    if (isLevel()) {
      parts.push('up to ' + view.allow.cards + ' circuits');
      if (view.schedules) parts.push(view.schedules.length + ' update orders');
      parts.unshift('Level ' + (index + 1));
    }
    $('limits').textContent = parts.join(' · ');
    document.title = view.name + ' — Quiet Lattice';
  }

  function layoutStage() {
    const level = isLevel();
    $('board').hidden = view === TRIAL;
    $('transport').hidden = view === TRIAL;
    $('status').hidden = view === TRIAL;
    $('trial').hidden = view !== TRIAL;
    $('sandbox').hidden = view !== SANDBOX;
    $('cases').hidden = !level;
    $('runs').hidden = !level;
    $('verdict').hidden = !level;
    if (view === SANDBOX) renderSandbox();
    if (view === TRIAL) renderTrial();
    renderKey();
    measureBoard();
  }

  // ------------------------------------------------------------------ rule

  function onRuleChanged(immediate) {
    compileError = null;
    try { prog = QL.compile(rule); } catch (err) { prog = null; compileError = err.message; }
    histories[view.id].record(JSON.stringify(rule));        // every change can be undone, however it was made
    save();
    renderMachine();
    syncRuleText();
    resetSim();
    clearTimeout(judgeTimer);
    if (!isLevel()) {
      verdict = null;
      if (view === TRIAL) {
        if (trial.data) { trial.token++; trial.running = false; trial.stale = true; }
        renderTrial();
      }
      return;
    }
    if (immediate) runJudge(); else judgeTimer = setTimeout(runJudge, 120);
  }

  function runJudge() {
    verdict = QL.judge(view, rule);
    if (verdict.pass && !store.solved[view.id]) {
      store.solved[view.id] = verdict.score;
      recordSolve();
      save();
      renderNav();
    } else if (verdict.pass) {
      store.solved[view.id] = verdict.score;
      recordSolve();
      save();
    }
    renderVerdict();
    renderCases();
    coachCheck();
  }

  function scoreText(score) {
    let text = plural(score.cards, 'circuit') + ', ' + plural(score.bits, 'signal');
    if (score.ticks != null) text += ', ' + score.ticks + ' ticks';
    return text;
  }

  function renderVerdict() {
    const el = $('verdict');
    if (!isLevel()) return;
    if (compileError) {
      el.innerHTML = '<div class="head">This rule cannot be read.</div><div class="detail">'
        + esc(compileError) + '</div>';
      return;
    }
    if (!verdict) { el.innerHTML = ''; return; }
    const cases = verdict.cases;
    let head, detail = '';
    if (verdict.pass) {
      head = 'Solved.';
      detail = 'Yours: ' + scoreText(verdict.score) + '. Best known: ' + scoreText(view.par) + '.';
    } else if (cases.length === 1 && cases[0].runs > 1) {
      head = cases[0].counts.quiet + ' of ' + cases[0].runs + ' lattices quiet; '
        + cases[0].need + ' needed.';
    } else {
      const passed = cases.filter(function (c) { return c.pass; }).length;
      head = passed + ' of ' + cases.length + ' patterns quiet' + (view.dark ? ' and dark' : '') + '.';
    }
    if (verdict.problems.length) {
      detail = 'Not allowed here: ' + verdict.problems.join('; ') + '.';
      if (verdict.cases.every(function (c) { return c.pass; })) head = 'Quiet, but outside the limits.';
    }
    let html = '<div class="head">' + esc(head);
    const index = levels.indexOf(view);
    if (verdict.pass) {
      const next = views[index + 1];
      html += '<button class="link next" type="button" id="next">Next: ' + esc(next.name) + '</button>';
    }
    // the rules known for a level are shown only once it has been solved
    if (store.solved[view.id]) {
      html += '<button class="link next" type="button" id="board-open" aria-haspopup="dialog">Leaderboard</button>';
    }
    html += '</div>';
    if (detail) html += '<div class="detail">' + esc(detail) + '</div>';
    el.innerHTML = html;
    if ($('board-open')) $('board-open').addEventListener('click', openBoard);
    const nextButton = $('next');
    if (nextButton) nextButton.addEventListener('click', function () { setView(views[index + 1].id); });
  }

  // ----------------------------------------------------------------- cards

  const NODE = { here: [66, 66], E: [110, 66], W: [22, 66], S: [66, 110], N: [66, 22] };
  const STEP = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };
  // a top right, b bottom right, c bottom left, d top left: a quarter turn
  // clockwise carries each signal's spot onto the next one's.
  const PIP = [[13, -13], [13, 13], [-13, 13], [-13, -13]];
  const STATE_WORD = { undefined: 'any', 1: 'required', 0: 'forbidden' };

  /** The picture of a card. `opts.fixed` draws it without anything to click, for Help. */
  function stencil(card, index, opts) {
    const then = QL.parseThen(card.then);
    const fixed = !!(opts && opts.fixed);
    const mini = !!(opts && opts.mini);       // drawn small: bolder marks, no faint dots
    const nSignals = opts && opts.signals != null ? opts.signals : allowedSignals();
    let s = fixed ? '<svg class="stencil' + (mini ? ' mini' : '') + '" viewBox="0 0 132 132" role="img" aria-label="'
      + esc(QL.words.card(card)) + '">' + (mini ? '<title>' + esc(QL.words.card(card)) + '</title>' : '')
      : '<svg class="stencil" viewBox="0 0 132 132" role="group" aria-label="Card '
      + (index + 1) + ', what the site must see">';
    for (const pos of ['E', 'W', 'S', 'N']) {
      s += '<line class="link-line" x1="66" y1="66" x2="' + NODE[pos][0] + '" y2="' + NODE[pos][1] + '"/>';
    }
    if (then.kind === 'move') {
      const d = STEP[QL.DIRS[then.arg - 1]];
      const px = -d[1], py = d[0];
      s += '<line class="arrow" x1="' + (66 + 12 * d[0]) + '" y1="' + (66 + 12 * d[1])
        + '" x2="' + (66 + 28 * d[0]) + '" y2="' + (66 + 28 * d[1]) + '"/>';
      s += '<polygon class="arrowhead" points="'
        + (66 + 34 * d[0]) + ',' + (66 + 34 * d[1]) + ' '
        + (66 + 26 * d[0] + 4.5 * px) + ',' + (66 + 26 * d[1] + 4.5 * py) + ' '
        + (66 + 26 * d[0] - 4.5 * px) + ',' + (66 + 26 * d[1] - 4.5 * py) + '"/>';
    }
    for (const pos of QL.POS) {
      const cx = NODE[pos][0], cy = NODE[pos][1];
      const cond = card.when[pos] || {};
      const locked = then.kind === 'move' && pos === 'here';
      const v = locked ? 1 : cond.defect;
      if (!fixed) {
        s += '<circle class="hit' + (locked ? ' locked' : '') + '" data-act="cond" data-card="' + index
          + '" data-pos="' + pos + '" data-f="defect" cx="' + cx + '" cy="' + cy + '" r="9.5"><title>'
          + DIR_NAMES[pos] + ': defect ' + (locked ? 'required (only a defect can move)' : STATE_WORD[v])
          + '</title></circle>';
      }
      if (v === 1) {
        s += '<circle class="glyph on" cx="' + cx + '" cy="' + cy + '" r="7"/>';
      } else if (v === 0) {
        s += '<g class="glyph"><circle class="off" cx="' + cx + '" cy="' + cy + '" r="6.5"/>'
          + '<line class="slash" x1="' + (cx - 4.4) + '" y1="' + (cy + 4.4) + '" x2="' + (cx + 4.4)
          + '" y2="' + (cy - 4.4) + '"/></g>';
      } else {
        s += '<circle class="glyph any" cx="' + cx + '" cy="' + cy + '" r="6.5"/>';
      }
      for (let k = 0; k < nSignals; k++) {
        const name = QL.SIGNALS[k];
        const x = cx + PIP[k][0], y = cy + PIP[k][1];
        const pv = cond[name];
        const color = 'var(--sig-' + name + ')';
        if (!fixed) {
          s += '<circle class="hit" data-act="cond" data-card="' + index + '" data-pos="' + pos
            + '" data-f="' + name + '" cx="' + x + '" cy="' + y + '" r="7"><title>' + DIR_NAMES[pos]
            + ': signal ' + name + ' ' + (pv === 1 ? 'must be lit' : pv === 0 ? 'must be dark' : 'any')
            + '</title></circle>';
        }
        if (pv === 1) {
          s += '<circle class="glyph" cx="' + x + '" cy="' + y + '" r="' + (mini ? 6 : 4.2) + '" fill="' + color + '"/>';
        } else if (pv === 0) {
          const r = mini ? 5 : 3.6, h = mini ? 6.4 : 4.6, w = mini ? 2.6 : 1.5;
          s += '<g class="glyph"><circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="var(--surface)" stroke="'
            + color + '" stroke-width="' + w + '"/><line x1="' + (x - h) + '" y1="' + (y + h) + '" x2="'
            + (x + h) + '" y2="' + (y - h) + '" stroke="' + color
            + '" stroke-width="' + w + '" stroke-linecap="round"/></g>';
        } else if (!mini) {
          s += '<circle class="glyph pip any" cx="' + x + '" cy="' + y + '" r="2.4"/>';
        }
      }
    }
    if (then.kind === 'light' || then.kind === 'clear') {
      const name = QL.SIGNALS[then.arg];
      s += '<circle class="halo' + (then.kind === 'clear' ? ' clear' : '') + '" cx="' + (66 + PIP[then.arg][0]) + '" cy="' + (66 + PIP[then.arg][1])
        + '" r="' + (mini ? 9.5 : 7.5) + '" stroke="var(--sig-' + name + ')"/>';
    }
    return s + '</svg>';
  }

  // ----------------------------------------------------------------- bench

  /*
   * The machine is assembled on a bench: one site and its four neighbours.
   * A circuit is some probes and one part that acts (a driver, an emitter or
   * an absorber); it is a card of the rule, drawn large. Every terminal a
   * probe can sit on is one bit of what a site sees: five defect sockets,
   * twenty signal sockets and the coin.
   */
  const BENCH = { C: [200, 190], R: 118, pip: 27, coin: [40, 40], sym: [352, 40] };
  const TOOLS = ['probe', 'driver', 'emitter', 'absorber'];
  const TOOL_NAMES = { probe: 'Probe', driver: 'Driver', emitter: 'Emitter', absorber: 'Absorber' };
  const TOOL_TIPS = {
    probe: 'Probe: click a circle on the bench. Once, and something must be there. Twice, and it must not. A third click takes it off.',
    driver: 'Driver: click a rail. The defect on this site is pushed along it. Click the driver again to take it off.',
    emitter: 'Emitter: click a small circle of the middle site. The circuit lights that signal. Click the emitter again to take it off.',
    absorber: 'Absorber: click a small circle of the middle site. The circuit switches that signal off. Click the absorber again to take it off.',
  };
  // what the bench shows: the circuit chosen on the rack, to build, or the whole machine, to look at
  let benchMode = store.benchView === 'machine' ? 'machine' : 'circuit';
  let selected = 0;        // the circuit on the bench
  let tool = 'probe';      // the part in hand: it stays there until another is taken from the tray

  function benchAt(pos) {
    const d = pos === 'here' ? [0, 0] : STEP[pos];
    return [BENCH.C[0] + BENCH.R * d[0], BENCH.C[1] + BENCH.R * d[1]];
  }
  function benchPip(pos, k) {
    const at = benchAt(pos);
    return [at[0] + PIP[k][0] / 13 * BENCH.pip, at[1] + PIP[k][1] / 13 * BENCH.pip];
  }

  /** The parts of one circuit as they sit on the bench; `ghost` for a turned copy. */
  function benchParts(card, ghost) {
    const then = QL.parseThen(card.then);
    const C = BENCH.C;
    const anchor = then.kind === 'none' ? null : then.kind === 'move' ? C : benchPip('here', then.arg);
    let s = '';
    if (!ghost && anchor) {             // a wire from every probe to the part that acts
      const wire = function (at) {
        return '<line class="wire" x1="' + at[0] + '" y1="' + at[1] + '" x2="' + anchor[0] + '" y2="' + anchor[1] + '"/>';
      };
      for (const pos of QL.POS) {
        const cond = card.when[pos] || {};
        if (cond.defect != null && !(pos === 'here' && then.kind === 'move')) s += wire(benchAt(pos));
        QL.SIGNALS.forEach(function (name, k) { if (cond[name] != null) s += wire(benchPip(pos, k)); });
      }
      if (card.coin != null) s += wire(BENCH.coin);
    }
    for (const pos of QL.POS) {         // probes
      const cond = card.when[pos] || {};
      const at = benchAt(pos);
      const v = then.kind === 'move' && pos === 'here' ? 1 : cond.defect;
      if (v === 1) {
        s += '<circle class="probe" cx="' + at[0] + '" cy="' + at[1] + '" r="11"/>';
      } else if (v === 0) {
        s += '<circle class="probe inverted" cx="' + at[0] + '" cy="' + at[1] + '" r="10.5"/>'
          + '<line class="slash" x1="' + (at[0] - 7.4) + '" y1="' + (at[1] + 7.4) + '" x2="' + (at[0] + 7.4)
          + '" y2="' + (at[1] - 7.4) + '"/>';
      }
      QL.SIGNALS.forEach(function (name, k) {
        const pv = cond[name];
        if (pv == null) return;
        const p = benchPip(pos, k), color = 'var(--sig-' + name + ')';
        if (pv === 1) {
          s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="5.5" fill="' + color + '"/>';
        } else {
          s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="5" fill="var(--page)" stroke="' + color
            + '" stroke-width="2"/><line x1="' + (p[0] - 6) + '" y1="' + (p[1] + 6) + '" x2="' + (p[0] + 6)
            + '" y2="' + (p[1] - 6) + '" stroke="' + color + '" stroke-width="2" stroke-linecap="round"/>';
        }
      });
    }
    if (then.kind === 'move') {          // the part that acts
      const d = STEP[QL.DIRS[then.arg - 1]], px = -d[1], py = d[0];
      s += '<line class="driver" x1="' + (C[0] + 19 * d[0]) + '" y1="' + (C[1] + 19 * d[1])
        + '" x2="' + (C[0] + 62 * d[0]) + '" y2="' + (C[1] + 62 * d[1]) + '"/>'
        + '<polygon class="driver-head" points="'
        + (C[0] + 78 * d[0]) + ',' + (C[1] + 78 * d[1]) + ' '
        + (C[0] + 60 * d[0] + 9 * px) + ',' + (C[1] + 60 * d[1] + 9 * py) + ' '
        + (C[0] + 60 * d[0] - 9 * px) + ',' + (C[1] + 60 * d[1] - 9 * py) + '"/>';
    } else if (anchor) {
      s += '<circle class="' + (then.kind === 'clear' ? 'absorber' : 'emitter') + '" cx="' + anchor[0] + '" cy="'
        + anchor[1] + '" r="12.5" stroke="var(--sig-' + QL.SIGNALS[then.arg] + ')"/>';
    }
    return ghost ? '<g class="ghost">' + s + '</g>' : s;
  }

  /** The board itself: rails, sockets and the coin, with nothing on them. */
  function benchBoard() {
    const n = allowedSignals();
    const C = BENCH.C;
    let s = '';
    for (const dir of ['E', 'S', 'W', 'N']) {            // rails: the four qubits around the site
      const d = STEP[dir], to = benchAt(dir);
      s += '<line class="rail" x1="' + (C[0] + 16 * d[0]) + '" y1="' + (C[1] + 16 * d[1]) + '" x2="'
        + (to[0] - 16 * d[0]) + '" y2="' + (to[1] - 16 * d[1]) + '"/>';
    }
    s += '<text class="bench-label" x="' + C[0] + '" y="24" text-anchor="middle">north</text>'
      + '<text class="bench-label" x="' + C[0] + '" y="362" text-anchor="middle">south</text>'
      + '<text class="bench-label" x="' + (benchAt('W')[0]) + '" y="' + (C[1] + 60) + '" text-anchor="middle">west</text>'
      + '<text class="bench-label" x="' + (benchAt('E')[0]) + '" y="' + (C[1] + 60) + '" text-anchor="middle">east</text>';
    for (const pos of QL.POS) {                          // sockets
      const at = benchAt(pos);
      s += '<circle class="socket" cx="' + at[0] + '" cy="' + at[1] + '" r="16"/>';
      for (let k = 0; k < n; k++) {
        const p = benchPip(pos, k);
        s += '<circle class="socket pip" cx="' + p[0] + '" cy="' + p[1] + '" r="7.5" stroke="var(--sig-'
          + QL.SIGNALS[k] + ')"/>';
      }
    }
    if (view.allow.coin) {
      s += '<circle class="socket" cx="' + BENCH.coin[0] + '" cy="' + BENCH.coin[1] + '" r="13"/>'
        + '<text class="bench-label" x="' + BENCH.coin[0] + '" y="' + (BENCH.coin[1] + 30) + '" text-anchor="middle">coin</text>';
    }
    return s;
  }

  /** The mark of a symmetry setting, drawn around a point: one arrow, four arrows, or four signals. */
  function symmetryGlyph(turn, at) {
    const x = at[0], y = at[1];
    let s = '<path class="sym-cross" d="M' + x + ' ' + (y - 7) + 'v14M' + (x - 7) + ' ' + y + 'h14"/>';
    const head = function (dx, dy) {               // an arrowhead at the end of one arm
      const px = -dy, py = dx;
      return '<polygon class="sym-head" points="' + (x + 9.5 * dx) + ',' + (y + 9.5 * dy) + ' '
        + (x + 5 * dx + 3.2 * px) + ',' + (y + 5 * dy + 3.2 * py) + ' '
        + (x + 5 * dx - 3.2 * px) + ',' + (y + 5 * dy - 3.2 * py) + '"/>';
    };
    if (turn === 'none') {
      s += head(1, 0);
    } else if (turn === 'all') {
      s += head(1, 0) + head(0, 1) + head(-1, 0) + head(0, -1);
    } else {
      [[1, 0], [0, 1], [-1, 0], [0, -1]].forEach(function (d, k) {       // east, south, west, north: a, b, c, d
        s += '<circle cx="' + (x + 7 * d[0]) + '" cy="' + (y + 7 * d[1]) + '" r="3" fill="var(--sig-' + QL.SIGNALS[k] + ')"/>';
      });
    }
    return s;
  }

  /** The symmetry settings this level offers, in the order the button steps through them. */
  function turnOptions() { return ['none', 'all'].concat(allowedSignals() === 4 ? ['all+signals'] : []); }

  function drawBench() {
    if (benchMode === 'machine') { drawWholeMachine(); return; }
    const card = rule[selected];
    const n = allowedSignals();
    const C = BENCH.C;
    const sides = ['E', 'S', 'W', 'N'];
    let s = benchBoard();
    if (card) {
      const then = QL.parseThen(card.then);
      if (card.turn !== 'none') for (let r = 1; r < 4; r++) s += benchParts(QL.turned(card, r), true);
      s += benchParts(card, false);
      // the symmetry button: a setting of the circuit, in the corner opposite the coin
      const options = turnOptions();
      const next = options[(options.indexOf(card.turn) + 1) % options.length];
      s += '<circle class="socket" cx="' + BENCH.sym[0] + '" cy="' + BENCH.sym[1] + '" r="13"/>'
        + symmetryGlyph(card.turn, BENCH.sym)
        + '<text class="bench-label" x="' + BENCH.sym[0] + '" y="' + (BENCH.sym[1] + 30) + '" text-anchor="middle">symmetry</text>'
        + '<text class="bench-label value" x="' + BENCH.sym[0] + '" y="' + (BENCH.sym[1] + 43) + '" text-anchor="middle">'
        + TURN_NAMES[card.turn] + '</text>';
      if (view.allow.coin && card.coin != null) {
        s += '<circle class="probe" cx="' + BENCH.coin[0] + '" cy="' + BENCH.coin[1] + '" r="10"/>'
          + '<text class="coin-face" x="' + BENCH.coin[0] + '" y="' + (BENCH.coin[1] + 4.5) + '" text-anchor="middle">'
          + (card.coin === 1 ? 'H' : 'T') + '</text>';
      }
      // what can be clicked lies on top; a place the part in hand does not fit is idle
      const word = function (v) { return v === 1 ? 'probe' : v === 0 ? 'inverted probe' : 'no probe'; };
      const probing = tool === 'probe';
      const cls = function (place, extra) {
        const live = QL.bench.accepts(card, tool, place);
        return 'hit' + (extra || '') + (live ? (probing ? '' : ' target') : ' idle');
      };
      for (const dir of sides) {
        const d = STEP[dir], to = benchAt(dir);
        s += '<line class="' + cls({ rail: dir }, ' rail-hit') + '" data-act="rail" data-dir="' + dir
          + '" x1="' + (C[0] + 36 * d[0]) + '" y1="' + (C[1] + 36 * d[1]) + '" x2="' + (to[0] - 36 * d[0])
          + '" y2="' + (to[1] - 36 * d[1]) + '"><title>' + DIR_NAMES[dir] + ' rail: '
          + (card.then === 'move:' + dir ? 'take the driver off' : 'put the driver here') + '</title></line>';
      }
      for (const pos of QL.POS) {
        const cond = card.when[pos] || {};
        const at = benchAt(pos);
        const locked = then.kind === 'move' && pos === 'here';
        const place = pos === 'here' ? 'this site' : DIR_NAMES[pos] + ' site';
        s += '<circle class="' + cls({ pos, feature: 'defect' }) + '" data-act="socket" data-pos="' + pos
          + '" data-f="defect" cx="' + at[0] + '" cy="' + at[1] + '" r="18"><title>' + place + ', defect: '
          + (locked ? 'a driver needs a defect to push' : word(cond.defect)) + '</title></circle>';
        for (let k = 0; k < n; k++) {
          const name = QL.SIGNALS[k], p = benchPip(pos, k);
          const mount = !probing && QL.bench.accepts(card, tool, { pos, feature: name });
          const sits = card.then === (tool === 'emitter' ? 'light:' : 'clear:') + name;
          s += '<circle class="' + cls({ pos, feature: name }) + '" data-act="socket" data-pos="' + pos + '" data-f="'
            + name + '" cx="' + p[0] + '" cy="' + p[1] + '" r="11"><title>' + place + ', signal ' + name + ': '
            + (mount ? (sits ? 'take the ' + tool + ' off' : 'put the ' + tool + ' here') : word(cond[name]))
            + '</title></circle>';
        }
      }
      if (view.allow.coin) {
        s += '<circle class="' + cls({ coin: true }) + '" data-act="coin" data-f="coin" cx="' + BENCH.coin[0]
          + '" cy="' + BENCH.coin[1] + '" r="16"><title>coin: '
          + (card.coin === 1 ? 'heads' : card.coin === 0 ? 'tails' : 'no probe') + '</title></circle>';
      }
      s += '<circle class="hit" data-act="turn" cx="' + BENCH.sym[0] + '" cy="' + BENCH.sym[1] + '" r="17"><title>symmetry: '
        + TURN_NAMES[card.turn] + ' (' + TURN_TIPS[card.turn] + '). Click for ' + TURN_NAMES[next] + '.</title></circle>';
    }
    $('bench').setAttribute('aria-label', 'Bench: this site and its four neighbours');
    $('bench').innerHTML = s;
  }

  /*
   * The whole machine on one site. The board is the bench's, drawn with the
   * neighbours further out so that the middle site has room, because that is
   * where every circuit acts.
   *
   * Every part is a small token with the number of its circuit, its place in
   * the sequence. A driver's token sits on its rail with the arrow ahead of
   * it; where several circuits drive along the same rail their arrows run
   * side by side. An emitter or absorber is a ring docked at its signal by a
   * short stem, solid or dashed; several dock around the same signal. A probe
   * is a lead from the token to the terminal it reads, ending in a dot on the
   * rim: filled for a probe, open for an inverted one. Turned copies are
   * faint, without number or leads. The circuit chosen on the rack is in ink.
   */
  const WHOLE = {
    R: 146, token: 8.5,
    // the middle site's signals stand further out and larger than on the bench: every ring docks at one of them
    pip: 44, pipRadius: 9,
    // where the tokens of one signal dock: distance from the signal, and angle off the diagonal that points away from the site
    docks: [[25, 0], [25, -46], [25, 46], [45, -23], [45, 23], [45, -66], [45, 66], [64, 0], [64, -32], [64, 32]],
  };

  function drawWholeMachine() {
    const C = BENCH.C, R = WHOLE.R, T = WHOLE.token;
    const n = allowedSignals();
    const unit = function (dx, dy) { const len = Math.hypot(dx, dy) || 1; return [dx / len, dy / len]; };
    const at = function (pos) { return pos === 'here' ? C : [C[0] + R * STEP[pos][0], C[1] + R * STEP[pos][1]]; };
    const pipAt = function (pos, k) {
      const p = at(pos), off = pos === 'here' ? WHOLE.pip : BENCH.pip;
      return [p[0] + PIP[k][0] / 13 * off, p[1] + PIP[k][1] / 13 * off];
    };
    const pipRadius = function (pos) { return pos === 'here' ? WHOLE.pipRadius : 7.5; };

    let s = '';
    for (const dir of ['E', 'S', 'W', 'N']) {
      const d = STEP[dir], to = at(dir);
      s += '<line class="rail" x1="' + (C[0] + 16 * d[0]) + '" y1="' + (C[1] + 16 * d[1]) + '" x2="'
        + (to[0] - 16 * d[0]) + '" y2="' + (to[1] - 16 * d[1]) + '"/>';
    }
    for (const pos of QL.POS) {
      const p = at(pos);
      s += '<circle class="socket" cx="' + p[0] + '" cy="' + p[1] + '" r="16"/>';
      for (let k = 0; k < n; k++) {
        const q = pipAt(pos, k);
        s += '<circle class="socket pip" cx="' + q[0] + '" cy="' + q[1] + '" r="' + pipRadius(pos) + '" stroke="var(--sig-'
          + QL.SIGNALS[k] + ')"/>';
      }
    }
    if (view.allow.coin) {
      s += '<circle class="socket" cx="' + BENCH.coin[0] + '" cy="' + BENCH.coin[1] + '" r="13"/>'
        + '<text class="bench-label" x="' + BENCH.coin[0] + '" y="' + (BENCH.coin[1] + 30) + '" text-anchor="middle">coin</text>';
    }

    // where every part sits; copies that land on the same spot as their original count once
    const places = {};
    for (const pass of [0, 1]) {               // the circuits themselves first, then their turned copies
      rule.forEach(function (card, k) {
        const taken = {};
        for (let r = 0; r < (card.turn === 'none' ? 1 : 4); r++) {
          const copy = r === 0 ? card : QL.turned(card, r);
          const then = QL.parseThen(copy.then);
          if (then.kind === 'none') continue;
          const key = then.kind === 'move' ? 'rail:' + QL.DIRS[then.arg - 1] : 'pip:' + then.arg;
          if (taken[key + then.kind]) continue;
          taken[key + then.kind] = true;
          if ((r === 0) === (pass === 0)) (places[key] || (places[key] = [])).push({ k, r, card: copy, then });
        }
      });
    }
    const parts = [];
    Object.keys(places).forEach(function (key) {
      const list = places[key], m = list.length;
      list.forEach(function (part, j) {
        if (part.then.kind === 'move') {
          const d = STEP[QL.DIRS[part.then.arg - 1]];
          const lane = (j - (m - 1) / 2) * (m > 1 ? Math.min(18, 52 / (m - 1)) : 0);
          const base = [C[0] - d[1] * lane, C[1] + d[0] * lane];
          const along = function (len) { return [base[0] + len * d[0], base[1] + len * d[1]]; };
          part.d = d;
          part.c = along(50);
          part.start = along(part.r === 0 ? 50 + T : 50);
          part.neck = along(94);
          part.tip = along(106);
        } else {
          const p = pipAt('here', part.then.arg);
          const dock = WHOLE.docks[j % WHOLE.docks.length];
          const out = unit(PIP[part.then.arg][0], PIP[part.then.arg][1]);
          const turn = dock[1] * Math.PI / 180, cos = Math.cos(turn), sin = Math.sin(turn);
          const v = [out[0] * cos - out[1] * sin, out[0] * sin + out[1] * cos];
          const size = part.r === 0 ? T : 5;
          part.size = size;
          part.c = [p[0] + dock[0] * v[0], p[1] + dock[0] * v[1]];
          part.stem = [[p[0] + WHOLE.pipRadius * v[0], p[1] + WHOLE.pipRadius * v[1]],
            [part.c[0] - size * v[0], part.c[1] - size * v[1]]];
        }
        parts.push(part);
      });
    });

    const shape = function (part) {
      const color = part.then.kind === 'move' ? '' : ' style="stroke: var(--sig-' + QL.SIGNALS[part.then.arg] + ')"';
      let out = '';
      if (part.then.kind === 'move') {
        const d = part.d, px = -d[1], py = d[0], w = 5.5;
        out += '<line class="m-shaft" x1="' + part.start[0] + '" y1="' + part.start[1] + '" x2="' + part.neck[0] + '" y2="'
          + part.neck[1] + '"/><polygon class="m-head" points="' + part.tip[0] + ',' + part.tip[1] + ' '
          + (part.neck[0] + w * px) + ',' + (part.neck[1] + w * py) + ' '
          + (part.neck[0] - w * px) + ',' + (part.neck[1] - w * py) + '"/>';
        if (part.r === 0) out += '<circle class="m-token" cx="' + part.c[0] + '" cy="' + part.c[1] + '" r="' + T + '"/>';
      } else {
        out += '<line class="m-stem" x1="' + part.stem[0][0] + '" y1="' + part.stem[0][1] + '" x2="' + part.stem[1][0]
          + '" y2="' + part.stem[1][1] + '"' + color + '/>'
          + '<circle class="m-token ring' + (part.then.kind === 'clear' ? ' absorber' : '') + '" cx="' + part.c[0]
          + '" cy="' + part.c[1] + '" r="' + part.size + '"' + color + '/>';
      }
      return out;
    };

    // the probes of every circuit as leads from its token to the terminals it reads
    const leads = [];
    parts.forEach(function (part) {
      if (part.r !== 0) return;
      const card = part.card;
      const lead = function (key, to, radius, value) {
        const u = unit(to[0] - part.c[0], to[1] - part.c[1]);
        const from = [part.c[0] + T * u[0], part.c[1] + T * u[1]];
        leads.push({ part, key, to, radius, value, from, angle: Math.atan2(from[1] - to[1], from[0] - to[0]) });
      };
      for (const pos of QL.POS) {
        const cond = card.when[pos] || {};
        // a driver's own site goes without saying
        if (cond.defect != null && !(pos === 'here' && part.then.kind === 'move')) lead(pos + ':defect', at(pos), 16, cond.defect);
        QL.SIGNALS.forEach(function (name, f) {
          if (cond[name] != null) lead(pos + ':' + name, pipAt(pos, f), pipRadius(pos), cond[name]);
        });
      }
      if (card.coin != null) lead('coin', BENCH.coin, 13, card.coin);
    });
    // leads that reach a terminal from nearly the same side are spread along its rim
    const byTerminal = {};
    leads.forEach(function (l) { (byTerminal[l.key] || (byTerminal[l.key] = [])).push(l); });
    Object.keys(byTerminal).forEach(function (key) {
      const list = byTerminal[key].sort(function (x, y) { return x.angle - y.angle; });
      const apart = 7.6 / list[0].radius;
      for (let i = 1; i < list.length; i++) if (list[i].angle - list[i - 1].angle < apart) list[i].angle = list[i - 1].angle + apart;
      list.forEach(function (l) { l.cap = [l.to[0] + l.radius * Math.cos(l.angle), l.to[1] + l.radius * Math.sin(l.angle)]; });
    });

    // turned copies first, faint
    s += '<g class="m-ghosts">' + parts.filter(function (p) { return p.r !== 0; }).map(function (p) {
      return '<g' + (p.k === selected ? ' class="sel"' : '') + '>' + shape(p) + '</g>';
    }).join('') + '</g>';
    // then every circuit, the chosen one last so that it lies on top
    const order = rule.map(function (card, k) { return k; }).filter(function (k) { return k !== selected; });
    if (rule[selected]) order.push(selected);
    order.forEach(function (k) {
      const mine = parts.filter(function (p) { return p.k === k && p.r === 0; });
      if (!mine.length) return;
      let g = '<g class="net' + (k === selected ? ' sel' : '') + '" data-pick="' + k + '"><title>Circuit ' + (k + 1) + ': '
        + esc(QL.words.card(rule[k])) + '</title>';
      leads.filter(function (l) { return l.part.k === k; }).forEach(function (l) {
        g += '<line class="m-lead" x1="' + l.from[0] + '" y1="' + l.from[1] + '" x2="' + l.cap[0] + '" y2="' + l.cap[1] + '"/>'
          + '<circle class="m-cap' + (l.value ? '' : ' inverted') + '" cx="' + l.cap[0] + '" cy="' + l.cap[1] + '" r="3.4"/>';
      });
      mine.forEach(function (p) {
        g += shape(p)
          + '<text class="m-num" x="' + p.c[0] + '" y="' + (p.c[1] + 3.6) + '" text-anchor="middle">' + (k + 1) + '</text>'
          + (p.then.kind === 'move' ? '<line class="m-hit" x1="' + p.c[0] + '" y1="' + p.c[1] + '" x2="' + p.tip[0]
            + '" y2="' + p.tip[1] + '"/>' : '')
          + '<circle class="m-hit disc" cx="' + p.c[0] + '" cy="' + p.c[1] + '" r="11"/>';     // something comfortable to point at
      });
      s += g + '</g>';
    });
    if (!parts.length) {
      s += '<text class="bench-label" x="' + C[0] + '" y="' + (C[1] - 60) + '" text-anchor="middle">no circuit acts yet</text>';
    }
    $('bench').setAttribute('aria-label', 'The whole machine: every circuit on one site');
    $('bench').innerHTML = s;
  }

  function toolIcon(name) {
    const shapes = {
      probe: '<circle cx="7" cy="7" r="4.5" fill="currentColor"/>',
      driver: '<path d="M2 7h7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
        + '<path d="M13 7 8 3.6v6.8z" fill="currentColor"/>',
      emitter: '<circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.8"/>',
      absorber: '<circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2.6 2.2"/>',
    };
    return '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">' + shapes[name] + '</svg>';
  }

  function availableTools() {
    const n = allowedSignals();
    return TOOLS.filter(function (name) {
      return name === 'probe' || name === 'driver' || (name === 'emitter' && n > 0)
        || (name === 'absorber' && n > 0 && !!view.allow.clear);
    });
  }

  function renderMachine() {
    if (selected >= rule.length) selected = Math.max(0, rule.length - 1);
    if (availableTools().indexOf(tool) < 0) tool = 'probe';
    const card = rule[selected];

    // the sequence: a circuit is chosen by a click, moved by dragging it, removed by the cross at its corner
    $('rack').innerHTML = rule.map(function (item, k) {
      return '<span class="rack-slot' + (k === selected ? ' current' : '') + '">'
        + '<button type="button" class="rack-item' + (QL.isBlank(item) ? ' blank' : '') + '" data-sel="' + k
        + '" aria-current="' + String(k === selected) + '" aria-label="Circuit ' + (k + 1) + ' of ' + rule.length + ': '
        + esc(QL.words.card(item)) + ' Drag to move it; Alt with the left or right arrow moves it too.">'
        + '<span class="rack-index">' + (k + 1) + '</span>' + compactCard(item) + '</button>'
        + '<button type="button" class="rack-remove" data-remove="' + k + '" aria-label="Remove circuit ' + (k + 1)
        + '" title="Remove this circuit">×</button></span>';
    }).join('');

    const building = benchMode === 'circuit';
    $('tray').innerHTML = '<span class="label">Parts</span>' + availableTools().map(function (name) {
      return '<button type="button" class="tray-item" data-tool="' + name + '" aria-pressed="'
        + String(building && name === tool) + '" title="' + esc(TOOL_TIPS[name]) + '">' + toolIcon(name)
        + TOOL_NAMES[name] + '</button>';
    }).join('');

    drawBench();

    const modes = [['circuit', 'Circuit', 'the circuit chosen on the rack, to build and change'],
      ['machine', 'Machine', 'every circuit of the machine at once, on one site']];
    $('bench-tools').innerHTML = '<span class="label">View</span><div class="choice" role="group">'
      + modes.map(function (m) {
        return '<button type="button" data-mode="' + m[0] + '" aria-pressed="' + String(benchMode === m[0])
          + '" title="' + m[2] + '">' + m[1] + '</button>';
      }).join('') + '</div>'
      + (building ? '' : '<span class="bench-legend">'
        + '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3.3" fill="currentColor"/></svg>probe'
        + '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3.3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>inverted probe'
        + '<span>numbers: place in the sequence</span><span>faint: turned copies</span></span>');
    $('reads').textContent = card ? (building ? '' : 'Circuit ' + (selected + 1) + '. ') + QL.words.card(card) : '';
    $('undo').disabled = !histories[view.id].canUndo();
    $('redo').disabled = !histories[view.id].canRedo();

    const drivers = rule.filter(function (c) { return QL.parseThen(c.then).kind === 'move'; }).length;
    const blanks = rule.filter(QL.isBlank).length;
    $('cards-note').textContent = rule.length === 0 ? 'No circuits: nothing ever happens.'
      : blanks ? plural(blanks, 'circuit') + ' without a part that acts.' : '';
    // what happens without any circuit saying so
    const builtin = ['Two defects on one site cancel.'];
    if (allowedSignals() > 0) {
      builtin.push('A signal lasts one tick. It is dark on the next tick unless an emitter lights it again.');
    }
    if (view.allow.clear) builtin.push('When an emitter and an absorber act on the same signal, the absorber wins.');
    if (drivers > 1) builtin.push('When several drivers could act, the circuit that comes first wins.');
    $('builtin').innerHTML = '<span class="label">Built in</span><ul>'
      + builtin.map(function (line) { return '<li>' + esc(line) + '</li>'; }).join('') + '</ul>';
    $('add').disabled = rule.length >= view.allow.cards;
    applyCoachTarget();
  }

  /** A click on the bench: a rail, a socket, the coin or the symmetry button; in the whole machine, a circuit. */
  function onBenchClick(event) {
    const picked = event.target.closest('[data-pick]');
    if (picked) { selected = Number(picked.getAttribute('data-pick')); renderMachine(); return; }
    const target = event.target.closest('[data-act]');
    const card = rule[selected];
    if (!target || !card) return;
    const act = target.getAttribute('data-act');
    if (act === 'turn') { QL.bench.turn(card, turnOptions()); onRuleChanged(false); return; }
    const place = act === 'rail' ? { rail: target.getAttribute('data-dir') }
      : act === 'coin' ? { coin: true }
      : act === 'socket' ? { pos: target.getAttribute('data-pos'), feature: target.getAttribute('data-f') } : null;
    // the part in hand decides what the click does, and stays in hand (src/bench.js)
    if (place && QL.bench.click(card, tool, place)) onRuleChanged(false);
  }

  function setBenchMode(mode) {
    benchMode = mode === 'machine' ? 'machine' : 'circuit';
    store.benchView = benchMode;
    save();
    coach.shown = '';
    renderMachine();
  }

  /** Taking a part means building: the bench goes back to the circuit. */
  function takeTool(name) {
    if (availableTools().indexOf(name) < 0) return;
    if (name === tool && benchMode === 'circuit') return;
    tool = name;
    setBenchMode('circuit');
  }

  /** Under the bench: what it shows. */
  function onBenchToolsClick(event) {
    const target = event.target.closest('[data-mode]');
    if (target) setBenchMode(target.getAttribute('data-mode'));
  }

  // ------------------------------------------------------- the sequence

  function removeCircuit(k) {
    if (k < 0 || k >= rule.length) return;
    rule.splice(k, 1);
    if (selected > k || selected >= rule.length) selected = Math.max(0, selected - 1);
    onRuleChanged(false);
  }

  function moveCircuit(from, to) {
    const before = JSON.stringify(rule);
    selected = QL.bench.move(rule, from, to);          // the circuit that was moved is the one on the bench
    if (JSON.stringify(rule) !== before) onRuleChanged(false); else renderMachine();
  }

  /** Put a machine from the history in place of the present one, and show where it differs. */
  function restore(written) {
    if (written == null) return;
    const before = clone(rule);
    const cards = JSON.parse(written);
    rule.length = 0;
    for (const card of cards) rule.push(card);
    selected = Math.min(QL.bench.firstDifference(before, rule), Math.max(0, rule.length - 1));
    onRuleChanged(false);
  }
  function undo() { restore(histories[view.id].undo()); }
  function redo() { restore(histories[view.id].redo()); }

  /*
   * Dragging a circuit along the rack. The circuit follows the pointer; a bar
   * shows where it would land. A press that does not move is an ordinary click.
   */
  let drag = null;
  let dragClick = 0;        // when a drag ended: the click that follows it is not a choice

  function rackSlots() { return Array.prototype.slice.call($('rack').children); }

  function dragStart(event) {
    const item = event.target.closest('.rack-item');
    if (!item || (event.button != null && event.button !== 0) || rule.length < 2) return;
    drag = { from: Number(item.getAttribute('data-sel')), id: event.pointerId, x: event.clientX, y: event.clientY,
      slot: item.parentNode, moving: false, to: null };
  }

  function dragMove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moving) {
      if (dx * dx + dy * dy < 49) return;
      drag.moving = true;
      drag.slot.classList.add('dragging');
      $('rack').parentNode.classList.add('sorting');
      try { drag.slot.setPointerCapture(drag.id); } catch (err) { /* the pointer is already gone */ }
    }
    event.preventDefault();
    drag.slot.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    const others = rackSlots().filter(function (slot) { return slot !== drag.slot; });
    drag.to = QL.bench.landing(others.map(function (slot) { return slot.getBoundingClientRect(); }), event.clientX, event.clientY);
    others.forEach(function (slot, k) {
      slot.classList.toggle('drop-before', drag.to !== drag.from && k === drag.to);
      slot.classList.toggle('drop-after', drag.to !== drag.from && drag.to === others.length && k === others.length - 1);
    });
  }

  function dragEnd(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const done = drag;
    drag = null;
    if (!done.moving) return;
    dragClick = Date.now();
    $('rack').parentNode.classList.remove('sorting');
    const dropped = event && event.type === 'pointerup' && done.to != null;
    if (dropped) moveCircuit(done.from, done.to); else renderMachine();
  }

  // ----------------------------------------------------------- leaderboard

  function ruleKey(cards) { return JSON.stringify(QL.normalizeRule(cards).cards); }

  /**
   * Remember a solve: the first one, and after that every rule that beats
   * this browser's best. A rule taken over from the leaderboard does not count.
   */
  function recordSolve() {
    const cards = QL.normalizeRule(rule).cards;
    if (store.borrowed[view.id] === JSON.stringify(cards)) return;
    const entry = Object.assign({ by: store.player.id, rule: cards, score: QL.ladder.scoreOf(view, verdict) },
      QL.ladder.stamp());
    const list = store.board[view.id] || (store.board[view.id] = []);
    for (let k = 0; k < list.length; k++) if (QL.ladder.rank(entry, list[k]) >= 0) return;
    list.push(entry);
    if (list.length > 12) list.shift();
  }

  /** The rules known for a level, best first. They are unpacked only once the level is solved. */
  function boardEntries(level) {
    if (!store.solved[level.id]) return [];
    let known = [];
    try { known = QL.ladder.unpack(level.id, QL.board.levels[level.id]); } catch (err) { known = []; }
    return known.concat(store.board[level.id] || []).sort(QL.ladder.compare);
  }

  /** Mark of a card that counts four ways; with four colours when the signals turn too. */
  function turnMark(turn) {
    if (turn !== 'all' && turn !== 'all+signals') return '';
    const label = turn === 'all' ? '4-fold symmetry' : '4-fold symmetry, signals cycle';
    let s = '<svg class="cmark" width="16" height="16" viewBox="0 0 16 16" role="img" aria-label="' + label
      + '"><title>' + label + '</title>'
      + '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/>';
    if (turn === 'all') {
      s += '<path d="M8 .8 5.9 3.9h4.2zM8 15.2 5.9 12.1h4.2zM.8 8l3.1-2.1v4.2zM15.2 8l-3.1-2.1v4.2z" fill="currentColor"/>';
    } else {
      const tip = [[13.4, 8], [8, 13.4], [2.6, 8], [8, 2.6]];          // east, south, west, north
      QL.SIGNALS.forEach(function (name, k) {
        s += '<circle cx="' + tip[k][0] + '" cy="' + tip[k][1] + '" r="2.3" fill="var(--sig-' + name + ')"/>';
      });
    }
    return s + '</svg>';
  }

  /** Mark of a card that asks for a face of the coin. */
  function coinMark(coin) {
    if (coin !== 0 && coin !== 1) return '';
    const label = coin === 1 ? 'only on heads' : 'only on tails';
    return '<svg class="cmark" width="16" height="16" viewBox="0 0 16 16" role="img" aria-label="' + label
      + '"><title>' + label + '</title><circle cx="8" cy="8" r="6.7" fill="none" stroke="currentColor" stroke-width="1.2"/>'
      + '<text x="8" y="11" text-anchor="middle">' + (coin === 1 ? 'H' : 'T') + '</text></svg>';
  }

  /** A card at a glance: its picture, small, over the marks of its turn and its coin. */
  function compactCard(card) {
    return '<span class="ccard">' + stencil(card, 0, { fixed: true, mini: true, signals: 4 })
      + '<span class="cmarks">' + turnMark(card.turn) + coinMark(card.coin) + '</span></span>';
  }

  function boardScoreText(score) {
    let text = score.quiet != null ? score.quiet + ' of ' + score.runs + ' quiet · ' : '';
    text += plural(score.cards, 'circuit') + ' · ' + plural(score.bits, 'signal');
    if (score.ticks != null) text += ' · ' + score.ticks + ' ticks';
    return text;
  }

  function renderBoard() {
    const entries = boardEntries(view);
    const places = QL.ladder.places(entries);
    const me = store.player.id;
    const sampled = entries.length > 0 && entries[0].score.quiet != null;
    let html = '<div class="help-head"><h2 id="board-title">Leaderboard: ' + esc(view.name) + '</h2>'
      + '<button class="link" type="button" id="board-close">Close</button></div>'
      + '<p>The machines known for this level, best first: ' + (sampled ? 'more lattices quiet, then ' : '')
      + 'fewer circuits, then fewer signals, then fewer ticks. Yours are added when you solve the level and '
      + 'whenever you beat your own best.</p>'
      + '<p class="board-legend"><span>' + turnMark('all') + '4-fold</span><span>' + turnMark('all+signals')
      + '4-fold + signals</span><span>' + coinMark(1) + 'only on heads</span><span>' + coinMark(0)
      + 'only on tails</span></p><ol class="board-list">';
    entries.forEach(function (entry, k) {
      const mine = entry.by === me;
      const when = QL.ladder.when(entry);
      const who = entry.by === 'house' ? 'house' : QL.ladder.nameOf(entry.by);
      html += '<li class="board-item' + (mine ? ' mine' : '') + '"><div class="board-line">'
        + '<span class="place">' + places[k] + '</span>'
        + '<span class="who">' + (mine ? 'you <span class="quiet-text">' + esc(who) + '</span>' : esc(who)) + '</span>'
        + '<span class="when"' + (when.zone ? ' title="time zone: ' + esc(when.zone) + '"' : '') + '>' + esc(when.text)
        + '</span></div>'
        + '<div class="board-score">' + esc(boardScoreText(entry.score)) + '</div>'
        + (entry.note ? '<div class="board-note">' + esc(entry.note) + '</div>' : '')
        + '<div class="board-cards">' + entry.rule.map(compactCard).join('') + '</div>'
        + '<button class="link" type="button" data-use="' + k + '">Use this machine</button></li>';
    });
    html += '</ol><p class="quiet-text">On this browser you are ' + esc(QL.ladder.nameOf(me)) + '. The name was '
      + 'drawn at random here and is kept only in this browser, with your rules and the times you solved them. '
      + 'Nothing is sent anywhere.</p>';
    $('leaderboard-body').innerHTML = html;
    $('board-close').addEventListener('click', function () { $('leaderboard').close(); });
    const buttons = $('leaderboard-body').querySelectorAll('[data-use]');
    for (let k = 0; k < buttons.length; k++) {
      buttons[k].addEventListener('click', function () {
        const entry = entries[Number(buttons[k].getAttribute('data-use'))];
        // a rule taken over from someone else is not a solve of one's own
        if (entry.by !== me) store.borrowed[view.id] = ruleKey(entry.rule);
        store.rules[view.id] = clone(entry.rule);
        rule = store.rules[view.id];
        $('leaderboard').close();
        onRuleChanged(true);
      });
    }
  }

  function openBoard() {
    if (!isLevel() || !store.solved[view.id]) return;
    if (sim.running) stop();
    renderBoard();
    const dialog = $('leaderboard');
    if (!dialog.open) { if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', ''); }
    dialog.scrollTop = 0;
  }

  // ------------------------------------------------------------------ help

  /** The first level, counted from 1, whose limits pass `test`. */
  function firstLevelWith(test) {
    for (let k = 0; k < levels.length; k++) if (test(levels[k].allow)) return k + 1;
    return 0;
  }

  /** One mark of the bench, drawn alone, for the lists in Help. */
  function mark(kind) {
    const blue = 'var(--sig-a)';
    const shapes = {
      any: '<circle cx="9" cy="9" r="6.5" fill="none" stroke="var(--axis)"/>',
      on: '<circle cx="9" cy="9" r="7" fill="var(--ink)"/>',
      off: '<circle cx="9" cy="9" r="6.5" fill="var(--surface)" stroke="var(--ink)" stroke-width="1.5"/>'
        + '<line x1="4.6" y1="13.4" x2="13.4" y2="4.6" stroke="var(--ink)" stroke-width="1.5" stroke-linecap="round"/>',
      'pip-any': '<circle cx="9" cy="9" r="2.4" fill="none" stroke="var(--axis)"/>',
      'pip-on': '<circle cx="9" cy="9" r="4.2" fill="' + blue + '"/>',
      'pip-off': '<circle cx="9" cy="9" r="3.6" fill="var(--surface)" stroke="' + blue + '" stroke-width="1.5"/>'
        + '<line x1="4.4" y1="13.6" x2="13.6" y2="4.4" stroke="' + blue + '" stroke-width="1.5" stroke-linecap="round"/>',
    };
    return '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">' + shapes[kind] + '</svg>';
  }

  function renderHelp() {
    const signalsOf = function (allow) { return allow.signals == null ? 4 : allow.signals; };
    const from = function (n) { return n > 1 ? ' <span class="quiet-text">From level ' + n + '.</span>' : ''; };
    const lvSignal = firstLevelWith(function (a) { return signalsOf(a) > 0; });
    const lvTurned = firstLevelWith(function (a) { return signalsOf(a) === 4; });
    const lvCoin = firstLevelWith(function (a) { return !!a.coin; });
    const lvClear = firstLevelWith(function (a) { return !!a.clear; });

    // where the five sites of the bench are
    const C = [112, 95], D = 48;
    const at = { E: [C[0] + D, C[1]], W: [C[0] - D, C[1]], S: [C[0], C[1] + D], N: [C[0], C[1] - D] };
    let anatomy = '<svg class="anatomy" viewBox="0 0 224 190" role="img" aria-label="The circle in the middle is '
      + 'the site itself. The four around it are its north, east, south and west neighbours.">';
    for (const pos of ['E', 'W', 'S', 'N']) {
      anatomy += '<line x1="' + C[0] + '" y1="' + C[1] + '" x2="' + at[pos][0] + '" y2="' + at[pos][1]
        + '" stroke="var(--grid)"/>';
    }
    for (const pos of ['E', 'W', 'S', 'N']) {
      anatomy += '<circle cx="' + at[pos][0] + '" cy="' + at[pos][1]
        + '" r="6.5" fill="var(--page)" stroke="var(--muted)"/>';
    }
    anatomy += '<circle cx="' + C[0] + '" cy="' + C[1] + '" r="7" fill="var(--ink)"/>'
      + '<line x1="119" y1="102" x2="133" y2="116" stroke="var(--muted)"/>'
      + '<text x="136" y="124">this site</text>'
      + '<text x="' + C[0] + '" y="' + (at.N[1] - 15) + '" text-anchor="middle">north</text>'
      + '<text x="' + C[0] + '" y="' + (at.S[1] + 24) + '" text-anchor="middle">south</text>'
      + '<text x="' + (at.W[0] - 14) + '" y="' + (C[1] + 4) + '" text-anchor="end">west</text>'
      + '<text x="' + (at.E[0] + 14) + '" y="' + (C[1] + 4) + '">east</text></svg>';

    // where the four signals sit around a circle
    let pips = '<svg class="anatomy" viewBox="0 0 224 76" role="img" aria-label="The four signals sit at the corners '
      + 'of a circle: a top right, b bottom right, c bottom left, d top left.">'
      + '<circle cx="112" cy="38" r="6.5" fill="var(--page)" stroke="var(--muted)"/>';
    QL.SIGNALS.forEach(function (name, k) {
      const x = 112 + PIP[k][0] * 1.25, y = 38 + PIP[k][1] * 1.25, right = PIP[k][0] > 0;
      pips += '<circle cx="' + x + '" cy="' + y + '" r="4.2" fill="var(--sig-' + name + ')"/>'
        + '<text x="' + (x + (right ? 12 : -12)) + '" y="' + (y + 4) + '" text-anchor="' + (right ? 'start' : 'end')
        + '">' + name + '</text>';
    });
    pips += '</svg>';

    // one reporting circuit under the two symmetry settings
    const turnRow = function (turn, caption) {
      const card = { when: { W: { defect: 1 } }, coin: null, then: 'light:a', turn };
      let html = '<div class="turn-row"><div class="turn-pics">';
      for (let r = 0; r < 4; r++) html += stencil(QL.turned(card, r), 0, { fixed: true, mini: true, signals: 4 });
      return html + '</div><p><em>' + TURN_NAMES[turn] + '</em>: ' + caption + '</p></div>';
    };

    const examples = [
      { when: { E: { defect: 1 } }, coin: null, then: 'move:E', turn: 'none' },
      { when: { N: { defect: 0 }, W: { a: 1 } }, coin: null, then: 'light:a', turn: 'none' },
    ].map(function (card) {
      return '<div class="help-example">' + stencil(card, 0, { fixed: true, signals: 1 })
        + '<p>' + esc(QL.words.card(card)) + '</p></div>';
    }).join('');

    $('help-body').innerHTML = '<div class="help-head"><h2 id="help-title">How the parts work</h2>'
      + '<button class="link" type="button" id="help-close">Close</button></div>'
      + '<p>Every site of the lattice carries the same small machine, and on every tick every one of them runs once. '
      + 'You build that machine on the bench. You never move anything yourself.</p>'
      + '<p>A machine is a list of <strong>circuits</strong>. A circuit is some probes and one part that acts: '
      + 'when every probe agrees, the part acts. The line of words above the bench says what the circuit on it does.</p>'

      + '<h3>Probes: what a circuit checks</h3>'
      + '<div class="help-row">' + anatomy + '<div>'
      + '<p>The bench shows one site and its four neighbours. With the <strong>probe</strong> in hand, click a '
      + 'circle to put a probe on that site. Each further click goes one on: probe, inverted probe, nothing.</p>'
      + '<ul class="marks">'
      + '<li>' + mark('any') + 'no probe: the site does not matter</li>'
      + '<li>' + mark('on') + 'probe: a defect must be there</li>'
      + '<li>' + mark('off') + 'inverted probe: no defect may be there</li>'
      + '</ul></div></div>'
      + '<div class="help-row">' + pips + '<div>'
      + '<p>The small circles around a site are its <strong>signals</strong>.' + from(lvSignal)
      + ' A probe on one reads that signal:</p>'
      + '<ul class="marks">'
      + '<li>' + mark('pip-any') + 'no probe</li>'
      + '<li>' + mark('pip-on') + 'probe: the signal must be lit</li>'
      + '<li>' + mark('pip-off') + 'inverted probe: it must be dark</li>'
      + '</ul></div></div>'
      + '<p>The <strong>coin</strong> in the corner of the bench is one more thing a probe can read.' + from(lvCoin)
      + ' Every site flips its own coin on every tick. With a probe on the coin the circuit acts only on heads, with '
      + 'an inverted probe only on tails: about half the time either way.</p>'

      + '<h3>Parts that act</h3>'
      + '<p>Take one from the tray and click where it goes. The part stays in your hand until you take another, '
      + 'and the places it fits are marked. A click on a part of the kind in hand takes it off again; nothing '
      + 'else happens to what is already there. A circuit holds one part that acts, so putting one on replaces '
      + 'the one before. Until a circuit has one, it does nothing.</p>'
      + '<dl class="help-list">'
      + '<dt>driver</dt><dd>Goes on a rail, one of the four qubits around the site. It flips that qubit, which '
      + 'pushes the defect on this site one place along the rail. If it lands on another defect, both vanish. '
      + 'A driver needs a defect to push, so the middle site of its circuit always carries a probe.</dd>'
      + '<dt>emitter</dt><dd>Goes on one of the small circles of the middle site and lights that signal for the '
      + 'next tick, where the neighbours can see it. The signal lasts that one tick only: to stay lit it must be '
      + 'lit again, tick after tick.' + from(lvSignal) + '</dd>'
      + '<dt>absorber</dt><dd>Goes on one of the small circles of the middle site and switches that signal off '
      + 'for the next tick, even if an emitter lights it. This is how a machine cleans up signals that have '
      + 'outlived their use.' + from(lvClear) + '</dd>'
      + '</dl>'

      + '<h3>Symmetry</h3>'
      + '<p>The button in the top right corner of the bench steps through the settings of the circuit on it. '
      + '<em>none</em>: the circuit works only the way it is built. <em>4-fold</em>: it also works turned a '
      + 'quarter, a half and three quarters of the way round, so one circuit does the work of four; the bench '
      + 'shows the three turned copies faintly. <em>4-fold + signals</em>: the same, and each quarter turn also '
      + 'moves every signal on by one: a becomes b, b becomes c, c becomes d, d becomes a.' + from(lvTurned) + '</p>'
      + '<p>Take a circuit that reports a defect: a probe on the west site and an emitter on a. These are the '
      + 'four copies each setting makes of it.</p>'
      + turnRow('all', 'all four copies light a. A site that sees a lit next door cannot tell on which side '
        + 'the defect is.')
      + turnRow('all+signals', 'the copies light a, b, c and d. Now a means a defect to the west, b one to '
        + 'the north, c one to the east and d one to the south, so each direction has its own signal.')

      + '<h3>Built in: what happens without a circuit</h3>'
      + '<ul class="plain">'
      + '<li><strong>Defects cancel in pairs.</strong> Two defects on one site vanish, and so do two '
      + 'neighbours that are pushed onto each other.</li>'
      + '<li><strong>A signal lasts one tick.</strong> On every tick each site works its signals out afresh: '
      + 'a signal is lit if an emitter fires, and dark otherwise. Nothing is remembered. A signal that seems '
      + 'to stay, or to travel, is being lit again on every tick by some circuit.</li>'
      + '<li><strong>The absorber wins.</strong> If an emitter and an absorber act on the same signal, it is dark.</li>'
      + '<li><strong>One push per site.</strong> If several drivers could fire, only the circuit that comes first '
      + 'in the machine does, so the order of circuits matters.</li>'
      + '<li><strong>Everyone at once.</strong> All sites look, then all act, at the same instant, unless a '
      + 'level says otherwise.</li>'
      + '</ul>'

      + '<h3>The sequence, and the whole machine</h3>'
      + '<p>The row of small pictures above the bench is the machine: its circuits, in order. Click one to put it on '
      + 'the bench. <strong>Drag</strong> one along the row to move it earlier or later. The <strong>×</strong> that '
      + 'appears at its corner removes it. <strong>Undo</strong> takes back the last change to the machine, '
      + 'whatever it was: a part, a probe, the symmetry, a move, a new circuit, a removed one. '
      + '<strong>Redo</strong> brings it back.</p>'
      + '<p>Under the bench, <strong>Machine</strong> shows every circuit at once on one site. Each part carries '
      + 'the number of its circuit. Where several circuits act on the same rail or the same signal, their drivers '
      + 'lie side by side and their emitters and absorbers are rings around one another. A probe is a line from '
      + 'the part to what it reads, ending in a dot: filled for a probe, open for an inverted one. Turned copies '
      + 'are faint. Click a part to choose its circuit; <strong>Circuit</strong> brings the bench back to build on.</p>'

      + '<h3>Two circuits, read out</h3>' + examples

      + '<h3>Keys</h3>'
      + '<p class="keys"><kbd>Space</kbd> play or pause <kbd>→</kbd> one tick <kbd>R</kbd> reset '
      + '<kbd>1</kbd>–<kbd>4</kbd> take a part from the tray <kbd>Ctrl</kbd> <kbd>Z</kbd> undo '
      + '<kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Z</kbd> redo <kbd>?</kbd> this page</p>'
      + '<p class="keys">On a circuit of the sequence: <kbd>Alt</kbd> <kbd>←</kbd> <kbd>→</kbd> move it '
      + '<kbd>Delete</kbd> remove it</p>';
    $('help-close').addEventListener('click', function () { $('help').close(); });
  }

  function openHelp() {
    const dialog = $('help');
    if (dialog.open) return;
    if (sim.running) stop();
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
    dialog.scrollTop = 0;
  }

  function ruleAsText() {
    return '{"format": "' + QL.FORMAT + '", "cards": [\n'
      + rule.filter(function (card) { return !QL.isBlank(card); })      // a circuit without a part that acts says nothing
        .map(function (card) { return '  ' + JSON.stringify(card); }).join(',\n') + '\n]}';
  }

  function syncRuleText() {
    $('ruletext').value = ruleAsText();
    $('ruletext-note').textContent = '';
  }

  function applyRuleText() {
    try {
      const parsed = QL.normalizeRule(JSON.parse($('ruletext').value));
      rule.length = 0;
      for (const card of parsed.cards) rule.push(card);
      onRuleChanged(true);
      $('ruletext-note').textContent = 'Applied.';
    } catch (err) {
      $('ruletext-note').textContent = 'Could not read this: ' + err.message;
    }
  }

  // ------------------------------------------------------------ simulation

  function currentPlan() {
    return QL.casePlan(view, view.cases[sim.caseIndex], prog || { usesCoin: false });
  }

  function resetSim() {
    stop();
    sim.result = null;
    if (isLevel()) {
      const plan = currentPlan();
      if (sim.runIndex >= plan.length) sim.runIndex = 0;
      const run = plan[sim.runIndex];
      sim.lat = QL.setupCase(view, view.cases[sim.caseIndex], run.sampleSeed);
      sim.random = QL.rng(run.seed);
      sim.schedule = run.schedule;
      sim.noise = 0;
      sim.maxTicks = view.maxTicks;
    } else if (view === SANDBOX) {
      const L = store.sandbox.L;
      if (!sandboxErrors || sandboxErrors.length !== 2 * L * L) sandboxErrors = new Uint8Array(2 * L * L);
      sim.lat = QL.makeLattice(L);
      for (let e = 0; e < sandboxErrors.length; e++) if (sandboxErrors[e]) QL.flipError(sim.lat, e);
      sim.random = QL.rng((Math.random() * 4294967296) >>> 0);
      sim.schedule = store.sandbox.schedule;
      sim.noise = store.sandbox.noise;
      sim.maxTicks = 0;
    } else {
      sim.lat = null;
    }
    draw();
    renderStatus();
  }

  function finish(result) {
    sim.result = result;
    stop();
  }

  /** How the run on screen has ended, or null while it is still going. */
  function settled() {
    if (sim.noise !== 0 || sim.lat.defects !== 0) return null;
    const result = QL.outcome(sim.lat);
    // a level that asks for a dark lattice keeps the clock running after the last defect
    if (result === 'quiet' && isLevel() && view.dark && QL.signalsLit(sim.lat) > 0) return null;
    return result;
  }

  function tickOnce() {
    if (!sim.lat || !prog || sim.result) return;
    let result = settled();
    if (result) { finish(result); return; }
    QL.step(sim.lat, prog, { schedule: sim.schedule, random: sim.random, noise: sim.noise });
    result = settled();
    if (result) finish(result);
    else if (sim.maxTicks && sim.lat.tick >= sim.maxTicks) finish(sim.lat.defects > 0 ? 'open' : 'lit');
  }

  function frame(now) {
    if (!sim.running) return;
    if (!sim.last) sim.last = now;
    sim.acc += (now - sim.last) * store.speed / 1000;
    sim.last = now;
    let steps = Math.min(6, Math.floor(sim.acc));
    sim.acc -= Math.floor(sim.acc);
    while (steps-- > 0 && sim.running) tickOnce();
    draw();
    renderStatus();
    if (sim.running) sim.raf = window.requestAnimationFrame(frame);
  }

  function play() {
    if (!prog || !sim.lat) return;
    if (sim.result) resetSim();
    sim.running = true;
    sim.last = 0;
    sim.acc = 1;                 // first tick right away
    $('play').textContent = 'Pause';
    sim.raf = window.requestAnimationFrame(frame);
  }

  function stop() {
    sim.running = false;
    window.cancelAnimationFrame(sim.raf);
    $('play').textContent = 'Play';
  }

  function stepOnce() {
    stop();
    if (sim.result) resetSim();
    tickOnce();
    draw();
    renderStatus();
  }

  function renderStatus() {
    const el = $('status');
    const lat = sim.lat;
    if (!lat) { el.textContent = ''; return; }
    if (!prog) { el.textContent = 'This rule cannot be read.'; return; }
    const order = sim.schedule === 'sync' ? '' : ' · ' + SCHEDULE_NAMES[sim.schedule];
    const dark = isLevel() && view.dark;
    let html;
    if (sim.result === 'quiet') {
      html = lat.tick === 0 ? 'Nothing to clean up.'
        : '<strong>' + (dark ? 'Quiet and dark' : 'Quiet') + '</strong> after ' + plural(lat.tick, 'tick') + '.';
    } else if (sim.result === 'lit') {
      html = '<span class="bad"><strong>Not dark</strong>: signals still lit on '
        + plural(QL.signalsLit(lat), 'site') + ' after ' + plural(lat.tick, 'tick') + '.</span>';
    } else if (sim.result === 'logical') {
      html = '<span class="bad"><strong>Logical error</strong> after ' + plural(lat.tick, 'tick')
        + ': the loop winds around the torus.</span>';
    } else if (sim.result === 'open') {
      html = '<span class="bad"><strong>Not quiet</strong>: ' + plural(lat.defects, 'defect')
        + ' left after ' + plural(lat.tick, 'tick') + '.</span>';
    } else {
      html = 'tick ' + lat.tick + ' · ' + plural(lat.defects, 'defect')
        + (dark ? ' · ' + plural(QL.signalsLit(lat), 'site') + ' lit' : '') + order;
    }
    el.innerHTML = html;
    coachCheck();
  }

  // ----------------------------------------------------------------- coach

  function coachContext() {
    return {
      rule, tick: sim.lat ? sim.lat.tick : 0, result: sim.result, caseIndex: sim.caseIndex, runIndex: sim.runIndex,
      selected, tool,
      pass: !!(verdict && verdict.pass), entryCards: coach.entryCards,
    };
  }

  function enterCoachStep(index) {
    const steps = coach.script.steps;
    coach.index = Math.max(0, Math.min(index, steps.length - 1));
    coach.entryCards = rule.length;
    const step = steps[coach.index];
    // a step that is already done when it opens waits for Next instead of flashing by
    coach.entryDone = !step.done || step.done(coachContext());
    store.coach[view.id] = coach.index;
    save();
    renderCoach();
  }

  function coachCheck() {
    if (!coach.script) return;
    const step = coach.script.steps[coach.index];
    if (step.done && !coach.entryDone && step.done(coachContext())) enterCoachStep(coach.index + 1);
    else applyCoachTarget();
  }

  function applyCoachTarget() {
    const old = document.querySelectorAll('.coach-target');
    for (let k = 0; k < old.length; k++) old[k].classList.remove('coach-target');
    if (!coach.script) return;
    const step = coach.script.steps[coach.index];
    if (!step.target || coach.entryDone) return;
    const selector = typeof step.target === 'function' ? step.target(coachContext()) : step.target;
    let el = selector ? document.querySelector(selector) : null;
    // a control of the bench is not there while the bench shows the whole machine: point at the way back
    if (!el && selector && selector.indexOf('#bench ') === 0 && benchMode === 'machine') {
      el = document.querySelector('#bench-tools [data-mode="circuit"]');
    }
    if (!el) return;
    el.classList.add('coach-target');
    // bring a newly pointed-at control into view, below the guide if the guide is pinned
    const key = view.id + ':' + coach.index + ':' + selector;
    if (key === coach.shown) return;
    coach.shown = key;
    const box = (el.closest('#bench') ? $('bench') : el).getBoundingClientRect();
    const guide = $('note');
    const pinned = window.getComputedStyle(guide).position === 'sticky';
    const top = pinned ? guide.getBoundingClientRect().bottom + 12 : 12;
    const bottom = window.innerHeight - 16;
    let delta = 0;
    if (box.bottom > bottom) delta = Math.min(box.bottom - bottom, box.top - top);
    else if (box.top < top) delta = box.top - top;
    if (Math.abs(delta) > 1) window.scrollBy(0, delta);
  }

  function renderCoach() {
    const el = $('coach');
    if (!coach.script) { el.hidden = true; el.innerHTML = ''; renderNote(); applyCoachTarget(); return; }
    el.hidden = false;
    const steps = coach.script.steps, step = steps[coach.index];
    const last = coach.index === steps.length - 1;
    // the step's number and title are the head of the note, which stays when the text is folded
    let html = step.text.map(function (p) { return '<p>' + p + '</p>'; }).join('');
    if (step.action) html += '<p class="coach-action">' + step.action + '</p>';
    html += '<div class="coach-bar">';
    if (last) {
      const next = views[views.indexOf(view) + 1];
      html += '<button class="btn primary" type="button" id="coach-go">Go on to ' + esc(next.name) + '</button>';
    } else if (!step.done || coach.entryDone) {
      html += '<button class="btn primary" type="button" id="coach-next">Next</button>';
    }
    if (coach.index > 0) html += '<button class="link" type="button" id="coach-back">Back</button>';
    html += last ? '<button class="link" type="button" id="coach-restart">Start this guide again</button>'
      : '<button class="link" type="button" id="coach-skip">Skip the guide</button>';
    el.innerHTML = html + '</div>';
    const on = function (id, fn) { const b = $(id); if (b) b.addEventListener('click', fn); };
    on('coach-next', function () { enterCoachStep(coach.index + 1); });
    on('coach-back', function () { enterCoachStep(coach.index - 1); });
    on('coach-skip', function () { enterCoachStep(steps.length - 1); });
    on('coach-go', function () { setView(views[views.indexOf(view) + 1].id); });
    on('coach-restart', function () {
      delete store.rules[view.id];
      store.coach[view.id] = 0;
      setView(view.id);
    });
    renderNote();
    applyCoachTarget();
  }

  // ------------------------------------------------------------------ note
  // The guide's step, or the level's brief, sits above the bench and folds to one line.
  // Folded, it says when there is something in it that has not been read.

  function noteKey() { return coach.script ? 'step ' + coach.index : 'brief'; }

  /** What the guide's own button would do now, or null while the step waits for the bench. */
  function notePrimary() {
    if (!coach.script) return null;
    const steps = coach.script.steps, step = steps[coach.index];
    if (coach.index === steps.length - 1) {
      const next = views[views.indexOf(view) + 1];
      return next ? { text: 'Go on to ' + next.name, go: function () { setView(next.id); } } : null;
    }
    if (step.done && !coach.entryDone) return null;
    return { text: 'Next', go: function () { enterCoachStep(coach.index + 1); } };
  }

  function renderNote() {
    const open = store.note.open;
    const key = noteKey();
    if (open && store.note.seen[view.id] !== key) { store.note.seen[view.id] = key; save(); }
    const unread = !open && store.note.seen[view.id] !== key;
    const note = $('note');
    note.className = 'note' + (coach.script ? ' guide' : '') + (open ? '' : ' folded') + (unread ? ' unread' : '');
    $('note-body').hidden = !open;
    $('note-toggle').setAttribute('aria-expanded', String(open));
    $('note-toggle').title = open ? 'Fold this text away' : (unread ? 'Not read yet. ' : '') + 'Show this text';
    $('note-mark').hidden = !unread;
    if (coach.script) {
      $('note-label').textContent = 'Step ' + (coach.index + 1) + ' of ' + coach.script.steps.length;
      $('note-title').textContent = coach.script.steps[coach.index].title;
    } else {
      $('note-label').textContent = 'Brief';
      $('note-title').textContent = open ? '' : view.brief[0];     // folded, the first line stays as a reminder
    }
    $('note-fold').textContent = open ? 'Hide' : 'Show';
    // once a step has been read, its Next is offered on the folded line too
    const primary = !open && !unread ? notePrimary() : null;
    $('note-next').hidden = !primary;
    $('note-next').textContent = primary ? primary.text : '';
  }

  function toggleNote() {
    store.note.open = !store.note.open;
    save();
    renderNote();
    coach.shown = '';          // the room above the bench changed: bring the pointed-at control back into view
    applyCoachTarget();
  }

  function renderCases() {
    const el = $('cases'), runs = $('runs');
    el.innerHTML = '';
    runs.innerHTML = '';
    if (!isLevel()) return;
    view.cases.forEach(function (spec, k) {
      const r = verdict && verdict.cases ? verdict.cases[k] : null;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'case' + (r ? (r.pass ? ' pass' : ' fail') : '');
      b.setAttribute('aria-pressed', String(k === sim.caseIndex));
      b.setAttribute('aria-label', spec.name + ': ' + (r ? (r.pass ? 'passes' : 'fails') : 'not checked'));
      b.innerHTML = '<span class="glyph"></span>' + esc(spec.name)
        + (r && r.runs > 1 ? ' ' + r.counts.quiet + '/' + r.runs : '');
      b.addEventListener('click', function () {
        sim.caseIndex = k; sim.runIndex = 0; resetSim(); renderCases();
      });
      el.appendChild(b);
    });

    const plan = currentPlan();
    if (plan.length < 2) return;
    const spec = view.cases[sim.caseIndex];
    const r = verdict && verdict.cases ? verdict.cases[sim.caseIndex] : null;
    const go = function (index) {
      sim.runIndex = (index + plan.length) % plan.length; resetSim(); renderCases();
    };
    const mk = function (text, label, fn) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'link'; b.textContent = text; b.setAttribute('aria-label', label);
      b.addEventListener('click', fn);
      return b;
    };
    runs.appendChild(mk('‹', 'Previous run', function () { go(sim.runIndex - 1); }));
    const text = document.createElement('span');
    text.textContent = (spec.random ? 'lattice ' : 'run ') + (sim.runIndex + 1) + ' of ' + plan.length
      + (view.schedules ? ' · ' + SCHEDULE_NAMES[plan[sim.runIndex].schedule] : '');
    runs.appendChild(text);
    runs.appendChild(mk('›', 'Next run', function () { go(sim.runIndex + 1); }));
    if (r && r.failures.length) {
      runs.appendChild(mk('Show a failure', 'Show the next run that fails', function () {
        const after = r.failures.find(function (f) { return f.index > sim.runIndex; }) || r.failures[0];
        go(after.index);
      }));
    }
  }

  // --------------------------------------------------------------- drawing

  function readTheme() {
    const cs = window.getComputedStyle(document.documentElement);
    const v = function (name) { return cs.getPropertyValue(name).trim(); };
    theme = {
      surface: v('--surface'), ink: v('--ink'), ink2: v('--ink-2'), muted: v('--muted'),
      grid: v('--grid'), axis: v('--axis'), critical: v('--critical'),
      sig: [v('--sig-a'), v('--sig-b'), v('--sig-c'), v('--sig-d')],
    };
  }

  function measureBoard() {
    const width = $('board').clientWidth;
    if (width > 0) {
      boardSize = Math.min(width, 600);
      // beside the bench the lattice stays pinned, so keep it, its controls and the verdict inside the window
      if (window.innerWidth > 980) boardSize = Math.max(300, Math.min(boardSize, window.innerHeight - 370));
    }
    draw();
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function draw() {
    const lat = sim.lat;
    const canvas = $('lattice');
    if (!lat || view === TRIAL) return;
    const size = boardSize;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(size * dpr);
    if (canvas.width !== px) {
      canvas.width = px; canvas.height = px;
      canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const L = lat.L, n = lat.n, s = size / L;
    const at = function (k) { return (k + 0.5) * s; };

    // the lattice: every edge is a qubit
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.grid;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let k = 0; k < L; k++) {
      const c = Math.round(at(k)) + 0.5;
      ctx.moveTo(0, c); ctx.lineTo(size, c);
      ctx.moveTo(c, 0); ctx.lineTo(c, size);
    }
    ctx.stroke();
    ctx.fillStyle = theme.axis;
    for (let i = 0; i < n; i++) {
      ctx.beginPath(); ctx.arc(at(i % L), at(Math.floor(i / L)), 1.5, 0, 6.2832); ctx.fill();
    }

    // edges that carry an error, a correction, or both
    const w = clamp(s * 0.085, 2.5, 5);
    const trace = function (e) {
      const i = e < n ? e : e - n;
      const y = Math.floor(i / L), x = i % L;
      if (e < n) {
        if (x < L - 1) { ctx.moveTo(at(x), at(y)); ctx.lineTo(at(x + 1), at(y)); }
        else { ctx.moveTo(at(x), at(y)); ctx.lineTo(size, at(y)); ctx.moveTo(0, at(y)); ctx.lineTo(at(0), at(y)); }
      } else if (y < L - 1) {
        ctx.moveTo(at(x), at(y)); ctx.lineTo(at(x), at(y + 1));
      } else {
        ctx.moveTo(at(x), at(y)); ctx.lineTo(at(x), size); ctx.moveTo(at(x), 0); ctx.lineTo(at(x), at(0));
      }
    };
    const stroke = function (pick, color, dash) {
      ctx.beginPath();
      for (let e = 0; e < 2 * n; e++) if (pick(lat.err[e], lat.cor[e])) trace(e);
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.lineCap = dash ? 'butt' : 'round';
      ctx.setLineDash(dash || []);
      ctx.stroke();
    };
    const residual = sim.result === 'logical' ? theme.critical : theme.ink;
    stroke(function (err, cor) { return err && cor; }, theme.axis, null);             // healed
    stroke(function (err, cor) { return err && !cor; }, residual, null);               // error
    stroke(function (err, cor) { return !err && cor; }, residual, [w * 0.9, w * 1.1]); // the rule's own path
    ctx.setLineDash([]);

    // sites, defects and signals
    const r = clamp(s * 0.19, 4, 11);
    const pr = clamp(s * 0.065, 2, 4.5);
    const off = clamp(s * 0.27, 7, 17);
    const corners = [[off, -off], [off, off], [-off, off], [-off, -off]];
    for (let i = 0; i < n; i++) {
      const x = at(i % L), y = at(Math.floor(i / L));
      if (lat.syn[i]) {
        ctx.fillStyle = theme.surface;
        ctx.beginPath(); ctx.arc(x, y, r + 2, 0, 6.2832); ctx.fill();
        ctx.fillStyle = theme.ink;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      }
      const sig = lat.sig[i];
      if (sig) {
        for (let k = 0; k < 4; k++) {
          if (!(sig & (1 << k))) continue;
          const sx = x + corners[k][0], sy = y + corners[k][1];
          ctx.fillStyle = theme.surface;
          ctx.beginPath(); ctx.arc(sx, sy, pr + 1.5, 0, 6.2832); ctx.fill();
          ctx.fillStyle = theme.sig[k];
          ctx.beginPath(); ctx.arc(sx, sy, pr, 0, 6.2832); ctx.fill();
        }
      }
    }
  }

  /** What the marks on the lattice mean. */
  function renderKey() {
    const el = $('key');
    el.hidden = view === TRIAL;
    if (view === TRIAL) return;
    const line = function (stroke, dash) {
      return '<svg width="26" height="10" aria-hidden="true"><line x1="2" y1="5" x2="24" y2="5" stroke="' + stroke
        + '" stroke-width="3.5"' + (dash ? ' stroke-dasharray="3.5 4"' : ' stroke-linecap="round"') + '/></svg>';
    };
    let html = '<span class="key"><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5.5" fill="var(--ink)"/></svg>defect</span>'
      + '<span class="key">' + line('var(--ink)', false) + 'qubit flipped by noise</span>'
      + '<span class="key">' + line('var(--ink)', true) + 'flipped by your rule</span>'
      + '<span class="key">' + line('var(--axis)', false) + 'flipped by both: undone</span>';
    const n = allowedSignals();
    if (n > 0) {
      html += '<span class="key">';
      for (let k = 0; k < n; k++) {
        html += '<svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="var(--sig-' + QL.SIGNALS[k] + ')"/></svg>';
      }
      html += (n === 1 ? 'signal a' : 'signals ' + QL.SIGNALS.slice(0, n).join(', ')) + '</span>';
    }
    el.innerHTML = html;
  }

  // --------------------------------------------------------------- sandbox

  function renderSandbox() {
    const box = $('sandbox');
    const sb = store.sandbox;
    const pct = function (v, digits) { return (100 * v).toFixed(digits) + ' %'; };
    box.innerHTML =
      '<div class="row"><span class="label">Size</span><div class="choice" id="sb-size" role="group"></div></div>'
      + '<div class="row"><span class="label">Scatter</span>'
      + '<input id="sb-p" type="range" min="0" max="0.1" step="0.005" value="' + sb.p + '" aria-label="Error probability per edge">'
      + '<output id="sb-p-out">' + pct(sb.p, 1) + '</output>'
      + '<button id="sb-scatter" class="btn" type="button">Scatter</button>'
      + '<button id="sb-clear" class="link" type="button">Clear</button></div>'
      + '<div class="row"><span class="label">Noise</span>'
      + '<input id="sb-noise" type="range" min="0" max="0.01" step="0.0005" value="' + sb.noise + '" aria-label="Error probability per edge per tick">'
      + '<output id="sb-noise-out">' + pct(sb.noise, 2) + '</output><span class="quiet-text">per edge, per tick</span></div>'
      + '<div class="row"><span class="label">Order</span><div class="choice" id="sb-order" role="group"></div></div>';
    fillChoice($('sb-size'), [8, 12, 16, 24].map(function (L) { return [String(L), L]; }), sb.L, function (L) {
      sb.L = L; sandboxErrors = null; save(); renderSandbox(); resetSim();
    });
    fillChoice($('sb-order'), ['sync', 'random', 'raster'].map(function (k) { return [SCHEDULE_NAMES[k], k]; }),
      sb.schedule, function (k) { sb.schedule = k; sim.schedule = k; save(); renderSandbox(); renderStatus(); });
    $('sb-p').addEventListener('input', function (event) {
      sb.p = Number(event.target.value); $('sb-p-out').textContent = pct(sb.p, 1); save();
    });
    $('sb-noise').addEventListener('input', function (event) {
      sb.noise = Number(event.target.value); sim.noise = sb.noise;
      $('sb-noise-out').textContent = pct(sb.noise, 2); save();
      if (sim.result) { sim.result = null; renderStatus(); }
    });
    $('sb-scatter').addEventListener('click', function () {
      const lat = QL.makeLattice(sb.L);
      QL.sprinkle(lat, sb.p, QL.rng((Math.random() * 4294967296) >>> 0));
      sandboxErrors = lat.err.slice();
      resetSim();
    });
    $('sb-clear').addEventListener('click', function () { sandboxErrors = null; resetSim(); });
  }

  function fillChoice(container, options, current, onPick) {
    container.innerHTML = '';
    for (const option of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = option[0];
      b.setAttribute('aria-pressed', String(option[1] === current));
      b.addEventListener('click', function () { onPick(option[1]); });
      container.appendChild(b);
    }
  }

  function onBoardClick(event) {
    if (view !== SANDBOX || !sim.lat) return;
    const rect = $('lattice').getBoundingClientRect();
    const L = sim.lat.L, s = rect.width / L;
    const u = (event.clientX - rect.left) / s - 0.5;
    const v = (event.clientY - rect.top) / s - 0.5;
    // nearest horizontal edge midpoint (x + 0.5, y) and vertical one (x, y + 0.5)
    const hx = Math.floor(u), hy = Math.round(v);
    const vx = Math.round(u), vy = Math.floor(v);
    const dh = Math.abs(u - (hx + 0.5)) + Math.abs(v - hy);
    const dv = Math.abs(u - vx) + Math.abs(v - (vy + 0.5));
    const e = dh <= dv ? QL.edgeIndex(L, 'h', hy, hx) : QL.edgeIndex(L, 'v', vy, vx);
    if (!sandboxErrors) sandboxErrors = new Uint8Array(2 * L * L);
    sandboxErrors[e] ^= 1;
    QL.flipError(sim.lat, e);
    if (sim.result) sim.result = null;
    draw();
    renderStatus();
  }

  // ----------------------------------------------------------------- trial

  function trialConfig() {
    return par || { seed: 20261115, sizes: [8, 12, 16], ps: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06], ticksPerL: 10, counts: [200, 1000], house: null };
  }

  function houseFails(L) {
    const cfg = trialConfig();
    const set = cfg.house && cfg.house[store.trial.schedule];
    const row = set && set[L] && set[L][store.trial.samples];
    return row || null;
  }

  function renderTrial() {
    const cfg = trialConfig();
    fillChoice($('trial-schedule'), [['all at once', 'sync'], ['random order', 'random']],
      store.trial.schedule, function (k) { store.trial.schedule = k; save(); trial.token++; trial.running = false; trial.data = null; renderTrial(); });
    fillChoice($('trial-samples'), cfg.counts.map(function (c) { return [c + ' lattices', c]; }),
      store.trial.samples, function (c) { store.trial.samples = c; save(); trial.token++; trial.running = false; trial.data = null; renderTrial(); });
    $('trial-run').textContent = trial.running ? 'Stop' : 'Run trial';
    $('trial-run').disabled = !prog;
    $('trial-progress').textContent = trial.stale ? 'The rule changed: run again.' : '';
    $('chart-sub').textContent = 'Share of lattices left with defects or a logical error. '
      + store.trial.samples + ' lattices per point, at most ' + cfg.ticksPerL + ' ticks per unit of size.';
    const sizes = cfg.sizes;
    $('legend').innerHTML = sizes.map(function (L, k) {
      return '<span class="key"><svg width="14" height="10"><circle cx="7" cy="5" r="4" fill="var(--size-'
        + (k + 1) + ')"/></svg>L = ' + L + '</span>';
    }).join('')
      + '<span class="key"><svg width="26" height="10"><line x1="1" y1="5" x2="25" y2="5" stroke="var(--ink-2)" stroke-width="2"/><circle cx="13" cy="5" r="3.5" fill="var(--ink-2)"/></svg>your rule</span>'
      + '<span class="key"><svg width="26" height="10"><line x1="1" y1="5" x2="25" y2="5" stroke="var(--ink-2)" stroke-width="1"/></svg>house rule</span>';
    drawChart();
    renderTrialNumbers();
  }

  const CHART = { W: 640, H: 380, l: 50, r: 62, t: 12, b: 42 };

  function chartScales() {
    const cfg = trialConfig();
    const N = store.trial.samples;
    const floor = 0.5 / N;
    const span = Math.log(1 / floor);
    return {
      floor,
      x: function (k) { return CHART.l + (CHART.W - CHART.l - CHART.r) * (k / (cfg.ps.length - 1)); },
      y: function (f) {
        const v = Math.max(f, floor);
        return CHART.t + (CHART.H - CHART.t - CHART.b) * (Math.log(1 / v) / span);
      },
    };
  }

  function drawChart() {
    const cfg = trialConfig();
    const N = store.trial.samples;
    const sc = chartScales();
    const bottom = CHART.H - CHART.b;
    let s = '';
    for (const tick of [1, 0.1, 0.01, 0.001]) {
      if (tick < sc.floor * 1.6) continue;
      const y = Math.round(sc.y(tick)) + 0.5;
      s += '<line class="gridline" x1="' + CHART.l + '" x2="' + (CHART.W - CHART.r) + '" y1="' + y + '" y2="' + y + '"/>';
      s += '<text x="' + (CHART.l - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + (tick * 100) + ' %</text>';
    }
    s += '<line class="axisline" x1="' + CHART.l + '" x2="' + (CHART.W - CHART.r) + '" y1="' + (bottom + 0.5) + '" y2="' + (bottom + 0.5) + '"/>';
    s += '<text x="' + (CHART.l - 8) + '" y="' + (bottom + 4) + '" text-anchor="end">none</text>';
    cfg.ps.forEach(function (p, k) {
      s += '<text x="' + sc.x(k) + '" y="' + (bottom + 18) + '" text-anchor="middle">' + Math.round(p * 1000) / 10 + ' %</text>';
    });
    s += '<text x="' + ((CHART.l + CHART.W - CHART.r) / 2) + '" y="' + (CHART.H - 6) + '" text-anchor="middle">error probability per edge</text>';

    const ends = [];
    cfg.sizes.forEach(function (L, j) {
      const color = 'var(--size-' + (j + 1) + ')';
      const house = houseFails(L);
      if (house) {
        s += '<path d="' + house.map(function (f, k) {
          return (k ? 'L' : 'M') + sc.x(k).toFixed(1) + ' ' + sc.y(f / N).toFixed(1);
        }).join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1" stroke-linejoin="round"/>';
      }
      const mine = trial.data ? trial.data.fails[L] : null;
      const done = trial.data ? trial.data.done[L] : null;
      let lastY = house ? sc.y(house[house.length - 1] / N) : null;
      if (mine) {
        let path = '', marks = '';
        for (let k = 0; k < mine.length; k++) {
          if (!done[k]) break;
          const f = mine[k] / done[k];
          const x = sc.x(k), y = sc.y(f);
          path += (path ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
          marks += mine[k] === 0
            ? '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.5" fill="var(--surface)" stroke="' + color + '" stroke-width="1.5"/>'
            : '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="5" fill="' + color + '" stroke="var(--surface)" stroke-width="2"/>';
          if (k === mine.length - 1) lastY = y;
        }
        if (path) s += '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' + marks;
      }
      if (lastY != null) ends.push({ y: lastY, text: 'L = ' + L });
    });
    // direct labels at the right end, only where they do not collide
    ends.sort(function (a, b) { return a.y - b.y; });
    let previous = -100;
    for (const end of ends) {
      if (end.y - previous < 13) continue;
      s += '<text class="end-label" x="' + (CHART.W - CHART.r + 10) + '" y="' + (end.y + 4).toFixed(1) + '">' + end.text + '</text>';
      previous = end.y;
    }
    if (trial.hover >= 0) {
      const x = Math.round(sc.x(trial.hover)) + 0.5;
      s += '<line class="cross" x1="' + x + '" x2="' + x + '" y1="' + CHART.t + '" y2="' + bottom + '"/>';
    }
    $('chart').innerHTML = s;
  }

  function percent(fails, n) {
    if (!n) return '–';
    if (fails === 0) return '0';
    const v = 100 * fails / n;
    return (v < 10 ? v.toFixed(1) : v.toFixed(0)) + ' %';
  }

  function onChartMove(event) {
    const cfg = trialConfig();
    const rect = $('chart').getBoundingClientRect();
    const sc = chartScales();
    const xView = (event.clientX - rect.left) * CHART.W / rect.width;
    let best = 0;
    for (let k = 1; k < cfg.ps.length; k++) {
      if (Math.abs(sc.x(k) - xView) < Math.abs(sc.x(best) - xView)) best = k;
    }
    if (best !== trial.hover) { trial.hover = best; drawChart(); }
    const N = store.trial.samples;
    let rows = '';
    cfg.sizes.forEach(function (L, j) {
      const house = houseFails(L);
      const mine = trial.data && trial.data.done[L][best] ? trial.data : null;
      rows += '<tr><td><span class="dot" style="background:var(--size-' + (j + 1) + ')"></span>L = ' + L + '</td><td>'
        + (mine ? percent(mine.fails[L][best], mine.done[L][best]) + ' (' + mine.fails[L][best] + ' of ' + mine.done[L][best] + ')' : '–')
        + '</td><td>' + (house ? percent(house[best], N) : '–') + '</td></tr>';
    });
    const tip = $('tip');
    tip.innerHTML = '<div class="tip-head">' + Math.round(cfg.ps[best] * 1000) / 10 + ' % per edge</div>'
      + '<table><tr><td></td><td>yours</td><td>house</td></tr>' + rows + '</table>';
    tip.hidden = false;
    const wrap = $('chart-wrap').getBoundingClientRect();
    const x = sc.x(best) * rect.width / CHART.W;
    const left = x + 14 + tip.offsetWidth > wrap.width ? x - 14 - tip.offsetWidth : x + 14;
    tip.style.left = Math.max(0, left) + 'px';
    tip.style.top = '8px';
  }

  function onChartLeave() {
    trial.hover = -1;
    $('tip').hidden = true;
    drawChart();
  }

  function renderTrialNumbers() {
    const cfg = trialConfig();
    const N = store.trial.samples;
    let html = '<table><tr><th>noise</th>';
    for (const L of cfg.sizes) html += '<th>L = ' + L + ', yours</th><th>house</th>';
    html += '</tr>';
    cfg.ps.forEach(function (p, k) {
      html += '<tr><td>' + Math.round(p * 1000) / 10 + ' %</td>';
      for (const L of cfg.sizes) {
        const house = houseFails(L);
        const d = trial.data;
        html += '<td>' + (d && d.done[L][k] ? percent(d.fails[L][k], d.done[L][k]) : '–') + '</td><td>'
          + (house ? percent(house[k], N) : '–') + '</td>';
      }
      html += '</tr>';
    });
    $('trial-table').innerHTML = html + '</table>';

    const reading = $('trial-reading');
    const d = trial.data;
    if (!d || trial.running || trial.stale) { reading.textContent = ''; return; }
    const small = cfg.sizes[0], large = cfg.sizes[cfg.sizes.length - 1];
    let upTo = -1, resolved = false;
    for (let k = 0; k < cfg.ps.length; k++) {
      if (d.fails[large][k] > d.fails[small][k]) break;
      if (d.fails[large][k] < d.fails[small][k]) resolved = true;
      upTo = k;
    }
    let text;
    if (upTo < 0 || !resolved) {
      text = 'The largest lattice never does better than the smallest here: no sign of a threshold.';
    } else if (upTo === cfg.ps.length - 1) {
      text = 'The largest lattice fails no more often than the smallest at every noise level tried.';
    } else {
      text = 'The largest lattice fails no more often than the smallest up to about '
        + Math.round(cfg.ps[upTo] * 1000) / 10 + ' % noise, and more often beyond it.';
    }
    reading.textContent = text + ' This is a reading of three small sizes, not a proof of a threshold.';
  }

  function nextFrame() { return new Promise(function (resolve) { window.setTimeout(resolve, 0); }); }

  async function runTrial() {
    if (trial.running) { trial.token++; trial.running = false; renderTrial(); return; }
    if (!prog) return;
    const token = ++trial.token;
    const cfg = trialConfig();
    const N = store.trial.samples, schedule = store.trial.schedule, program = prog;
    const data = { fails: {}, done: {} };
    for (const L of cfg.sizes) {
      data.fails[L] = cfg.ps.map(function () { return 0; });
      data.done[L] = cfg.ps.map(function () { return 0; });
    }
    trial.data = data;
    trial.running = true;
    trial.stale = false;
    renderTrial();
    const total = cfg.sizes.length * cfg.ps.length * N;
    let count = 0, painted = 0;
    for (const L of cfg.sizes) {
      for (let k = 0; k < cfg.ps.length; k++) {
        for (let first = 0; first < N; first += 20) {
          const c = QL.trial(program, {
            L, p: cfg.ps[k], count: Math.min(20, N - first), first,
            seed: cfg.seed, maxTicks: cfg.ticksPerL * L, schedule,
          });
          data.fails[L][k] += c.logical + c.open;
          data.done[L][k] += c.samples;
          count += c.samples;
          if (window.performance.now() - painted > 80) {
            $('trial-progress').textContent = Math.round(100 * count / total) + ' %';
            drawChart();
            await nextFrame();
            painted = window.performance.now();
            if (token !== trial.token) return;
          }
        }
      }
    }
    trial.running = false;
    renderTrial();
  }

  // ------------------------------------------------------------------ init

  function init() {
    readTheme();
    fillSpeed();
    $('bench').addEventListener('click', onBenchClick);
    $('bench-tools').addEventListener('click', onBenchToolsClick);
    $('rack').addEventListener('click', function (event) {
      const remove = event.target.closest('[data-remove]');
      if (remove) { removeCircuit(Number(remove.getAttribute('data-remove'))); return; }
      const item = event.target.closest('[data-sel]');
      if (!item || Date.now() - dragClick < 350) return;        // the end of a drag is not a choice
      selected = Number(item.getAttribute('data-sel'));
      renderMachine();
    });
    $('rack').addEventListener('pointerdown', dragStart);
    window.addEventListener('pointermove', dragMove, { passive: false });
    window.addEventListener('pointerup', dragEnd);
    window.addEventListener('pointercancel', dragEnd);
    $('rack').addEventListener('keydown', function (event) {
      const item = event.target.closest('.rack-item');
      if (!item) return;
      const k = Number(item.getAttribute('data-sel'));
      const refocus = function (index) {
        const again = document.querySelector('#rack [data-sel="' + index + '"]');
        if (again) again.focus();
      };
      if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        moveCircuit(k, k + (event.key === 'ArrowLeft' ? -1 : 1));
        refocus(selected);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeCircuit(k);
        refocus(Math.min(k, rule.length - 1));
      }
    });
    $('undo').addEventListener('click', undo);
    $('redo').addEventListener('click', redo);
    $('tray').addEventListener('click', function (event) {
      const item = event.target.closest('[data-tool]');
      if (item) takeTool(item.getAttribute('data-tool'));
    });
    $('add').addEventListener('click', function () {
      if (rule.length >= view.allow.cards) return;
      rule.push(QL.bench.blank());             // a new circuit is empty: the player puts the parts on
      selected = rule.length - 1;
      benchMode = 'circuit';                   // and the bench is where that happens
      store.benchView = benchMode;
      onRuleChanged(false);
    });
    $('clear').addEventListener('click', function () { rule.length = 0; selected = 0; onRuleChanged(false); });
    $('ruletext-apply').addEventListener('click', applyRuleText);
    $('ruletext-copy').addEventListener('click', function () {
      const text = $('ruletext').value;
      const done = function () { $('ruletext-note').textContent = 'Copied.'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { $('ruletext').select(); });
      } else { $('ruletext').select(); }
    });
    $('note-toggle').addEventListener('click', toggleNote);
    $('note-next').addEventListener('click', function () {
      const primary = notePrimary();
      if (primary) primary.go();
    });
    renderHelp();
    $('help-open').addEventListener('click', openHelp);
    $('help-cards').addEventListener('click', openHelp);
    $('help').addEventListener('click', function (event) {
      if (event.target === $('help')) $('help').close();        // a click outside the page of help
    });
    $('leaderboard').addEventListener('click', function (event) {
      if (event.target === $('leaderboard')) $('leaderboard').close();
    });
    $('play').addEventListener('click', function () { if (sim.running) stop(); else play(); });
    $('step').addEventListener('click', stepOnce);
    $('reset').addEventListener('click', resetSim);
    $('lattice').addEventListener('click', onBoardClick);
    $('trial-run').addEventListener('click', runTrial);
    $('chart').addEventListener('mousemove', onChartMove);
    $('chart').addEventListener('mouseleave', onChartLeave);

    document.addEventListener('keydown', function (event) {
      const tag = event.target.tagName;
      if ($('help').open || $('leaderboard').open || tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (event.key === '?') { event.preventDefault(); openHelp(); return; }
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
        if (key === 'y') { event.preventDefault(); redo(); return; }
      }
      // 1 to 4 take a part from the tray, in the order it shows them
      if (/^[1-4]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const name = availableTools()[Number(event.key) - 1];
        if (name) { event.preventDefault(); takeTool(name); }
        return;
      }
      if (tag === 'BUTTON' || tag === 'SUMMARY') return;
      if (view === TRIAL) return;
      if (event.key === ' ') { event.preventDefault(); if (sim.running) stop(); else play(); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); stepOnce(); }
      else if (event.key === 'r' || event.key === 'R') { resetSim(); }
    });

    if (window.ResizeObserver) new ResizeObserver(measureBoard).observe($('board'));
    window.addEventListener('resize', measureBoard);
    if (window.matchMedia) {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const onTheme = function () { readTheme(); draw(); };
      if (media.addEventListener) media.addEventListener('change', onTheme);
    }

    setView(store.view);
  }

  function fillSpeed() {
    fillChoice($('speed'), SPEEDS, store.speed, function (v) { store.speed = v; save(); fillSpeed(); });
  }

  init();
})();
