/*
 * Quiet Lattice — engine.
 *
 * Pure logic, no DOM. Loaded as a classic script in the browser (global `QL`)
 * and with require() in Node.
 *
 * Model (one CSS sector of the toric code, ideal sensing):
 *   - L x L sites on a torus. Each site is a check; qubits are the edges.
 *   - Edge order is "horizontal then vertical, row-major":
 *       e = y*L + x          horizontal edge joining (y, x) and (y, x+1)
 *       e = L*L + y*L + x    vertical edge joining (y, x) and (y+1, x)
 *   - A site holds a defect when an odd number of its four edges is flipped
 *     in the residual (error XOR correction).
 *   - A site also carries four signal bits a, b, c, d.
 *
 * A rule is a list of cards. Every site applies the same cards to what it can
 * see: itself and its four neighbours, in the order here, E, W, S, N. For each
 * of those five sites it sees the defect bit and the four signal bits. It can
 * also read one fresh coin per update.
 *
 *   - A "light" card turns one of the site's own signals on for the next
 *     tick. A signal that no card lights goes dark.
 *   - A "move" card flips the edge towards one neighbour. Only a site holding
 *     a defect may move, so a rule can never create a pair. The first matching
 *     move card wins.
 *
 * Synchronous ticks: every site reads the same pre-tick state; an edge that
 * one or both of its ends propose is flipped once (OR tie-break).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QL = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FORMAT = 'quiet-lattice-rule/1';
  const POS = ['here', 'E', 'W', 'S', 'N'];
  const DIRS = ['E', 'W', 'S', 'N'];               // move codes 1..4
  const FEATURES = ['defect', 'a', 'b', 'c', 'd'];
  const SIGNALS = ['a', 'b', 'c', 'd'];
  const TURNS = ['none', 'all', 'all+signals'];
  // One quarter turn clockwise on screen (y grows downwards):
  // here->here, E->S, W->N, S->W, N->E.
  const TURN_POS = [0, 3, 4, 2, 1];
  const COIN_BIT = 1 << 25;
  const SCHEDULES = ['sync', 'random', 'shuffle', 'raster', 'reverse', 'columns'];

  // ---------------------------------------------------------------- random

  function rng(seed) {
    let a = seed >>> 0;
    function u32() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    }
    return {
      u32,
      float: function () { return u32() / 4294967296; },
      bit: function () { return u32() >>> 31; },
      below: function (n) { return Math.floor((u32() / 4294967296) * n); },
    };
  }

  // -------------------------------------------------------------- geometry

  const geometryCache = new Map();

  function geometry(L) {
    let g = geometryCache.get(L);
    if (g) return g;
    if (!Number.isInteger(L) || L < 3) throw new Error('L must be an integer >= 3');
    const n = L * L;
    const E = new Int32Array(n), W = new Int32Array(n);
    const S = new Int32Array(n), N = new Int32Array(n);
    for (let y = 0; y < L; y++) {
      for (let x = 0; x < L; x++) {
        const i = y * L + x;
        E[i] = y * L + (x + 1) % L;
        W[i] = y * L + (x + L - 1) % L;
        S[i] = ((y + 1) % L) * L + x;
        N[i] = ((y + L - 1) % L) * L + x;
      }
    }
    g = { L, n, E, W, S, N, nbr: [null, E, W, S, N] };
    geometryCache.set(L, g);
    return g;
  }

  /** Edge flipped when the defect at site i moves in direction code dir. */
  function moveEdge(g, i, dir) {
    if (dir === 1) return i;                // E: horizontal edge of i
    if (dir === 2) return g.W[i];           // W: horizontal edge of the west site
    if (dir === 3) return g.n + i;          // S: vertical edge of i
    return g.n + g.N[i];                    // N: vertical edge of the north site
  }

  /** The two sites an edge joins. */
  function edgeEnds(g, e) {
    return e < g.n ? [e, g.E[e]] : [e - g.n, g.S[e - g.n]];
  }

  function edgeIndex(L, kind, y, x) {
    const yy = ((y % L) + L) % L, xx = ((x % L) + L) % L;
    return (kind === 'v' ? L * L : 0) + yy * L + xx;
  }

  /** Edges of a walk that starts at (y, x) and follows a string of E/W/S/N steps. */
  function chainEdges(L, y, x, steps) {
    const g = geometry(L);
    let i = (((y % L) + L) % L) * L + (((x % L) + L) % L);
    const edges = [];
    for (const ch of steps) {
      const dir = DIRS.indexOf(ch) + 1;
      if (dir === 0) throw new Error('bad step "' + ch + '"');
      edges.push(moveEdge(g, i, dir));
      i = g.nbr[dir][i];
    }
    return edges;
  }

  // --------------------------------------------------------------- lattice

  function makeLattice(L) {
    const g = geometry(L);
    return {
      L, n: g.n, g,
      err: new Uint8Array(2 * g.n),   // error chain (noise)
      cor: new Uint8Array(2 * g.n),   // correction chain (the rule's moves)
      syn: new Uint8Array(g.n),       // defects
      sig: new Uint8Array(g.n),       // signal bits, a = 1, b = 2, c = 4, d = 8
      defects: 0,
      tick: 0,
      moves: 0,
    };
  }

  function cloneLattice(lat) {
    return {
      L: lat.L, n: lat.n, g: lat.g,
      err: lat.err.slice(), cor: lat.cor.slice(), syn: lat.syn.slice(), sig: lat.sig.slice(),
      defects: lat.defects, tick: lat.tick, moves: lat.moves,
    };
  }

  function toggleSite(lat, i) {
    if (lat.syn[i]) { lat.syn[i] = 0; lat.defects--; } else { lat.syn[i] = 1; lat.defects++; }
  }

  function flipError(lat, e) {
    lat.err[e] ^= 1;
    const ends = edgeEnds(lat.g, e);
    toggleSite(lat, ends[0]); toggleSite(lat, ends[1]);
  }

  function flipCorrection(lat, e) {
    lat.cor[e] ^= 1;
    const ends = edgeEnds(lat.g, e);
    toggleSite(lat, ends[0]); toggleSite(lat, ends[1]);
  }

  /** Independent error on every edge with probability p. Returns the count. */
  function sprinkle(lat, p, random) {
    let count = 0;
    for (let e = 0; e < 2 * lat.n; e++) {
      if (random.float() < p) { flipError(lat, e); count++; }
    }
    return count;
  }

  /**
   * 'open'    defects remain;
   * 'quiet'   no defects and the residual is a product of stabilizers;
   * 'logical' no defects but the residual winds around the torus.
   */
  function outcome(lat) {
    if (lat.defects > 0) return 'open';
    const L = lat.L, n = lat.n;
    let wx = 0, wy = 0;
    for (let k = 0; k < L; k++) {
      const h = k * L + (L - 1);            // horizontal edges crossing the x seam
      const v = n + (L - 1) * L + k;        // vertical edges crossing the y seam
      wx ^= lat.err[h] ^ lat.cor[h];
      wy ^= lat.err[v] ^ lat.cor[v];
    }
    return (wx | wy) ? 'logical' : 'quiet';
  }

  /** How many sites have a signal lit. */
  function signalsLit(lat) {
    let count = 0;
    for (let i = 0; i < lat.n; i++) if (lat.sig[i]) count++;
    return count;
  }

  // ------------------------------------------------------------------ rules

  function blankCard() {
    return { when: {}, coin: null, then: 'move:E', turn: 'none' };
  }

  /** A card still without an effect: it does nothing, and a clean rule leaves it out. */
  function isBlank(card) { return card.then == null || card.then === ''; }

  function parseThen(then) {
    if (then == null || then === '') return { kind: 'none', arg: 0 };
    const parts = String(then).split(':');
    if (parts[0] === 'move') {
      const dir = DIRS.indexOf(parts[1]) + 1;
      if (dir === 0) throw new Error('unknown move "' + then + '"');
      return { kind: 'move', arg: dir };
    }
    if (parts[0] === 'light' || parts[0] === 'clear') {
      const ch = SIGNALS.indexOf(parts[1]);
      if (ch < 0) throw new Error('unknown signal "' + then + '"');
      return { kind: parts[0], arg: ch };
    }
    throw new Error('unknown effect "' + then + '"');
  }

  /**
   * Returns a clean copy of a rule, or throws on anything unrecognised.
   * Cards without an effect are left out: they do nothing.
   */
  function normalizeRule(rule) {
    const cardsIn = Array.isArray(rule) ? rule : (rule && rule.cards);
    if (!Array.isArray(cardsIn)) throw new Error('a rule needs a list of cards');
    const numbered = cardsIn.map(function (card, index) { return { card, index }; })
      .filter(function (item) { return !isBlank(item.card); });
    const cards = numbered.map(function (item) {
      const card = item.card, index = item.index;
      const out = { when: {}, coin: null, then: card.then, turn: card.turn || 'none' };
      parseThen(out.then);
      if (TURNS.indexOf(out.turn) < 0) throw new Error('card ' + (index + 1) + ': unknown turn');
      if (card.coin === 0 || card.coin === 1) out.coin = card.coin;
      else if (card.coin != null) throw new Error('card ' + (index + 1) + ': coin must be 0, 1 or null');
      const when = card.when || {};
      for (const pos of Object.keys(when)) {
        if (POS.indexOf(pos) < 0) throw new Error('card ' + (index + 1) + ': unknown position ' + pos);
        for (const feature of Object.keys(when[pos])) {
          if (FEATURES.indexOf(feature) < 0) {
            throw new Error('card ' + (index + 1) + ': unknown feature ' + feature);
          }
          const v = when[pos][feature];
          if (v === 0 || v === 1) {
            if (!out.when[pos]) out.when[pos] = {};
            out.when[pos][feature] = v;
          } else if (v != null) {
            throw new Error('card ' + (index + 1) + ': conditions must be 0 or 1');
          }
        }
      }
      return out;
    });
    return { format: FORMAT, cards };
  }

  /**
   * The card turned r quarter turns clockwise (east to south to west to
   * north), exactly as the compiler expands it. With turn 'all+signals' every
   * quarter turn also moves each signal on by one: a to b to c to d to a.
   * The result is a plain card with turn 'none'.
   */
  function turned(card, r) {
    const shift = card.turn === 'all+signals' ? r : 0;
    const when = {};
    for (const pos of Object.keys(card.when || {})) {
      let p = POS.indexOf(pos);
      for (let k = 0; k < r; k++) p = TURN_POS[p];
      const cond = {};
      for (const feature of Object.keys(card.when[pos])) {
        let f = FEATURES.indexOf(feature);
        if (f > 0) f = 1 + ((f - 1 + shift) % 4);
        cond[FEATURES[f]] = card.when[pos][feature];
      }
      when[POS[p]] = cond;
    }
    const then = parseThen(card.then);
    let effect;
    if (then.kind === 'none') {
      effect = null;
    } else if (then.kind === 'move') {
      let dir = then.arg;
      for (let k = 0; k < r; k++) dir = TURN_POS[dir];
      effect = 'move:' + DIRS[dir - 1];
    } else {
      effect = then.kind + ':' + SIGNALS[(then.arg + shift) % 4];
    }
    return { when, coin: card.coin == null ? null : card.coin, then: effect, turn: 'none' };
  }

  /**
   * Expand turns and compile to bit masks over the 26-bit input word
   * (bit = position*5 + feature, coin = bit 25).
   */
  function compile(rule) {
    const norm = normalizeRule(rule);
    const lights = [], moves = [], clears = [];
    const seen = new Set();
    let usesCoin = false, channels = 0;
    for (const card of norm.cards) {
      const then = parseThen(card.then);
      const turns = card.turn === 'none' ? 1 : 4;
      const shiftSignals = card.turn === 'all+signals';
      for (let r = 0; r < turns; r++) {
        let mask = 0, value = 0;
        const shift = shiftSignals ? r : 0;
        for (const pos of Object.keys(card.when)) {
          let p = POS.indexOf(pos);
          for (let k = 0; k < r; k++) p = TURN_POS[p];
          for (const feature of Object.keys(card.when[pos])) {
            let f = FEATURES.indexOf(feature);
            if (f > 0) { f = 1 + ((f - 1 + shift) % 4); channels |= 1 << (f - 1); }
            const bit = 1 << (p * 5 + f);
            mask |= bit;
            if (card.when[pos][feature]) value |= bit;
          }
        }
        if (card.coin != null) {
          usesCoin = true;
          mask |= COIN_BIT;
          if (card.coin) value |= COIN_BIT;
        }
        let arg = then.arg;
        if (then.kind === 'move') {
          for (let k = 0; k < r; k++) arg = TURN_POS[arg];
          if ((mask & 1) && !(value & 1)) continue;   // "no defect here" can never move
          mask |= 1; value |= 1;                      // guard: only a defect moves
        } else {
          arg = (arg + shift) % 4;
          channels |= 1 << arg;
        }
        const key = then.kind + ':' + arg + ':' + mask + ':' + value;
        if (seen.has(key)) continue;
        seen.add(key);
        (then.kind === 'move' ? moves : then.kind === 'light' ? lights : clears).push({ mask, value, arg });
      }
    }
    let bits = 0;
    for (let k = 0; k < 4; k++) if (channels & (1 << k)) bits++;
    return {
      rule: norm,
      lights, moves, clears, usesCoin,
      channels, bits,
      cards: norm.cards.length,
      cache: new Map(),
    };
  }

  /**
   * Output for one input word: low 4 bits = next signals, bits 4..6 = move code.
   * A signal is lit next tick if a light card for it fits and no clear card
   * for it does: clearing wins.
   */
  function evaluate(prog, word) {
    let out = prog.cache.get(word);
    if (out !== undefined) return out;
    out = 0;
    const lights = prog.lights, moves = prog.moves, clears = prog.clears;
    for (let k = 0; k < lights.length; k++) {
      if ((word & lights[k].mask) === lights[k].value) out |= 1 << lights[k].arg;
    }
    for (let k = 0; k < clears.length; k++) {
      if ((word & clears[k].mask) === clears[k].value) out &= ~(1 << clears[k].arg);
    }
    if (word & 1) {
      for (let k = 0; k < moves.length; k++) {
        if ((word & moves[k].mask) === moves[k].value) { out |= moves[k].arg << 4; break; }
      }
    }
    prog.cache.set(word, out);
    return out;
  }

  function wordAt(lat, i) {
    const g = lat.g, syn = lat.syn, sig = lat.sig;
    const e = g.E[i], w = g.W[i], s = g.S[i], n = g.N[i];
    return (syn[i] | (sig[i] << 1))
      | ((syn[e] | (sig[e] << 1)) << 5)
      | ((syn[w] | (sig[w] << 1)) << 10)
      | ((syn[s] | (sig[s] << 1)) << 15)
      | ((syn[n] | (sig[n] << 1)) << 20);
  }

  // ------------------------------------------------------------------ steps

  function noiseStep(lat, noise, random) {
    if (!(noise > 0)) return;
    for (let e = 0; e < 2 * lat.n; e++) if (random.float() < noise) flipError(lat, e);
  }

  /**
   * One synchronous tick. `coins`, when given, is a Uint8Array of one coin per
   * site (used by the cross-language fixtures); otherwise coins come from
   * `random`, one per site in row-major order, only if the rule reads the coin.
   */
  function stepSync(lat, prog, random, coins) {
    const n = lat.n, g = lat.g;
    const next = new Uint8Array(n);
    const proposed = [];
    for (let i = 0; i < n; i++) {
      let word = wordAt(lat, i);
      if (prog.usesCoin) {
        if (coins ? coins[i] : random.bit()) word |= COIN_BIT;
      }
      const out = evaluate(prog, word);
      next[i] = out & 15;
      const dir = out >> 4;
      if (dir) proposed.push(moveEdge(g, i, dir));
    }
    const flipped = new Set();
    for (const e of proposed) {
      if (flipped.has(e)) continue;      // OR: a doubly proposed edge flips once
      flipped.add(e);
      flipCorrection(lat, e);
    }
    lat.moves += flipped.size;
    lat.sig = next;
    lat.tick++;
    return flipped;
  }

  /** One sequential update of site i: it sees everything that happened before. */
  function updateSite(lat, prog, i, random) {
    let word = wordAt(lat, i);
    if (prog.usesCoin && random.bit()) word |= COIN_BIT;
    const out = evaluate(prog, word);
    lat.sig[i] = out & 15;
    const dir = out >> 4;
    if (dir) { flipCorrection(lat, moveEdge(lat.g, i, dir)); lat.moves++; }
  }

  /**
   * One unit of time under a sequential schedule: L*L single-site updates.
   *   random   each update picks a uniformly random site (the embedded chain
   *            of independent rate-one site clocks)
   *   shuffle  every site once, in a fresh random order
   *   raster   every site once, row by row
   *   reverse  raster order backwards
   *   columns  every site once, column by column
   */
  function stepSequential(lat, prog, schedule, random) {
    const n = lat.n, L = lat.L;
    if (schedule === 'random') {
      for (let k = 0; k < n; k++) updateSite(lat, prog, random.below(n), random);
    } else if (schedule === 'shuffle') {
      const order = new Int32Array(n);
      for (let i = 0; i < n; i++) order[i] = i;
      for (let i = n - 1; i > 0; i--) {
        const j = random.below(i + 1);
        const t = order[i]; order[i] = order[j]; order[j] = t;
      }
      for (let k = 0; k < n; k++) updateSite(lat, prog, order[k], random);
    } else if (schedule === 'raster') {
      for (let i = 0; i < n; i++) updateSite(lat, prog, i, random);
    } else if (schedule === 'reverse') {
      for (let i = n - 1; i >= 0; i--) updateSite(lat, prog, i, random);
    } else if (schedule === 'columns') {
      for (let x = 0; x < L; x++) for (let y = 0; y < L; y++) updateSite(lat, prog, y * L + x, random);
    } else {
      throw new Error('unknown schedule ' + schedule);
    }
    lat.tick++;
  }

  /** Advance one tick: optional noise first, then the rule. */
  function step(lat, prog, options) {
    const schedule = options.schedule || 'sync';
    noiseStep(lat, options.noise || 0, options.random);
    if (schedule === 'sync') stepSync(lat, prog, options.random);
    else stepSequential(lat, prog, schedule, options.random);
  }

  /**
   * Quiet recovery: run until no defect is left or maxTicks is reached.
   * Returns { result: 'quiet' | 'logical' | 'open', ticks }.
   *
   * With options.dark the clock keeps running after the last defect, until no
   * signal is lit either. A lattice that is quiet but still has signals lit
   * at maxTicks ends as 'lit'.
   */
  function recover(lat, prog, options) {
    const maxTicks = options.maxTicks;
    const schedule = options.schedule || 'sync';
    const random = options.random;
    const dark = !!options.dark;
    for (;;) {
      const result = outcome(lat);
      const settled = result === 'logical' || (result === 'quiet' && !(dark && signalsLit(lat) > 0));
      if (settled) return { result, ticks: lat.tick };
      if (lat.tick >= maxTicks) return { result: result === 'quiet' ? 'lit' : result, ticks: lat.tick };
      if (schedule === 'sync') stepSync(lat, prog, random);
      else stepSequential(lat, prog, schedule, random);
    }
  }

  // ----------------------------------------------------------------- levels

  function caseEdges(L, spec) {
    const edges = [];
    for (const c of spec.chains || []) edges.push.apply(edges, chainEdges(L, c[0], c[1], c[2]));
    for (const e of spec.edges || []) edges.push(edgeIndex(L, e[0], e[1], e[2]));
    return edges;
  }

  /** Fresh lattice holding the errors of one level case. */
  function setupCase(level, spec, sampleSeed) {
    const lat = makeLattice(spec.L || level.L);
    for (const e of caseEdges(lat.L, spec)) flipError(lat, e);
    if (spec.random) {
      sprinkle(lat, spec.random.p, rng(sampleSeed != null ? sampleSeed : spec.random.seed));
    }
    return lat;
  }

  /**
   * The list of runs one case needs: every schedule of the level, each with
   * `seeds` seeds when the outcome can depend on chance, and one run per
   * sample for random cases.
   */
  function casePlan(level, spec, prog) {
    const schedules = level.schedules || ['sync'];
    const plan = [];
    const samples = spec.random ? spec.random.samples : 1;
    for (let s = 0; s < samples; s++) {
      for (const schedule of schedules) {
        const chancy = prog.usesCoin || schedule === 'random' || schedule === 'shuffle';
        const seeds = chancy && !spec.random ? (level.seeds || 1) : 1;
        for (let k = 0; k < seeds; k++) {
          plan.push({
            schedule,
            seed: 1000003 * (s + 1) + 7919 * k + 17,
            sampleSeed: spec.random ? spec.random.seed + s : null,
          });
        }
      }
    }
    return plan;
  }

  function runCase(level, spec, prog) {
    const plan = casePlan(level, spec, prog);
    const counts = { quiet: 0, logical: 0, open: 0, lit: 0 };
    const failures = [];
    let ticks = 0;
    for (let index = 0; index < plan.length; index++) {
      const run = plan[index];
      const lat = setupCase(level, spec, run.sampleSeed);
      const res = recover(lat, prog, {
        schedule: run.schedule, maxTicks: level.maxTicks, random: rng(run.seed), dark: level.dark,
      });
      counts[res.result]++;
      if (res.result === 'quiet') ticks += res.ticks;
      else if (failures.length < 24) failures.push({ index, run, result: res.result });
    }
    const need = spec.random && spec.random.need != null
      ? spec.random.need : plan.length;
    return {
      runs: plan.length, counts, need,
      pass: counts.quiet >= need,
      ticks: counts.quiet ? ticks / counts.quiet : null,
      failures,       // the first few runs that did not end quiet
    };
  }

  /** Check a rule against every case of a level and against its limits. */
  function judge(level, rule) {
    let prog;
    try { prog = compile(rule); } catch (err) { return { pass: false, error: err.message }; }
    const allow = level.allow || {};
    const problems = [];
    if (allow.cards != null && prog.cards > allow.cards) {
      problems.push('at most ' + allow.cards + ' circuits');
    }
    const allowedSignals = allow.signals == null ? 4 : allow.signals;
    if (prog.channels >> allowedSignals) problems.push('uses a signal that is not available here');
    if (prog.usesCoin && !allow.coin) problems.push('the coin is not available here');
    if (prog.clears.length && !allow.clear) problems.push('the absorber is not available here');
    const cases = level.cases.map(function (spec) { return runCase(level, spec, prog); });
    let ticks = 0, timed = true;
    for (const c of cases) { if (c.ticks == null) timed = false; else ticks += c.ticks; }
    return {
      pass: problems.length === 0 && cases.every(function (c) { return c.pass; }),
      problems, cases,
      score: { cards: prog.cards, bits: prog.bits, ticks: timed ? Math.round(ticks * 10) / 10 : null },
    };
  }

  // ------------------------------------------------------------------ trial

  /**
   * Code-capacity trial: independent errors with probability p on every edge,
   * then quiet recovery for at most maxTicks ticks. Returns outcome counts for
   * samples [first, first + count).
   */
  function trial(prog, options) {
    const counts = { quiet: 0, logical: 0, open: 0, samples: 0 };
    const first = options.first || 0;
    for (let s = first; s < first + options.count; s++) {
      const lat = makeLattice(options.L);
      sprinkle(lat, options.p, rng(options.seed + 7919 * s));
      const res = recover(lat, prog, {
        schedule: options.schedule || 'sync',
        maxTicks: options.maxTicks,
        random: rng(options.seed + 104729 * (s + 1)),
      });
      counts[res.result]++;
      counts.samples++;
    }
    return counts;
  }

  return {
    FORMAT, POS, DIRS, FEATURES, SIGNALS, TURNS, TURN_POS, COIN_BIT, SCHEDULES,
    rng, geometry, moveEdge, edgeEnds, edgeIndex, chainEdges,
    makeLattice, cloneLattice, flipError, flipCorrection, sprinkle, outcome, signalsLit,
    blankCard, isBlank, parseThen, normalizeRule, turned, compile, evaluate, wordAt,
    noiseStep, stepSync, updateSite, stepSequential, step, recover,
    caseEdges, setupCase, casePlan, runCase, judge, trial,
  };
});
