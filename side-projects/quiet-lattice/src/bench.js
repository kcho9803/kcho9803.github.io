/*
 * Quiet Lattice — what a click on the bench does.
 *
 * The part in hand decides, and it stays in hand until another is taken from
 * the tray. A probe goes on anything a site can see and steps through probe,
 * inverted probe, nothing. Every other part is either there or not: a click
 * where it sits takes it off, a click anywhere else it fits puts it there. A
 * circuit holds one part that acts, so putting one on replaces the one before.
 * A click where the part in hand does not fit does nothing.
 *
 * A place on the bench is one of
 *   { rail: 'E' }                     a qubit beside the middle site
 *   { pos: 'W', feature: 'defect' }   a socket: a site's defect or one of its signals
 *   { coin: true }                    the coin
 */
(function (root, factory) {
  const bench = factory();
  if (typeof module === 'object' && module.exports) module.exports = bench;
  else root.QL.bench = bench;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EFFECT = { driver: 'move', emitter: 'light', absorber: 'clear' };

  /** A circuit with nothing on it. Until it has a part that acts it does nothing. */
  function blank() { return { when: {}, coin: null, then: null, turn: 'none' }; }

  function drives(card) { return String(card.then).indexOf('move:') === 0; }

  /** What the part in hand would be as the circuit's effect at this place, or null if it does not go there. */
  function effectAt(tool, place) {
    if (tool === 'driver') return place.rail ? 'move:' + place.rail : null;
    if (tool === 'emitter' || tool === 'absorber') {
      return place.pos === 'here' && place.feature && place.feature !== 'defect' ? EFFECT[tool] + ':' + place.feature : null;
    }
    return null;
  }

  /** Does a click here, with this part in hand, change the circuit? */
  function accepts(card, tool, place) {
    if (tool === 'probe') {
      if (place.coin) return true;
      if (!place.pos) return false;
      // a driver already reads its own site: it needs a defect to push
      return !(place.pos === 'here' && place.feature === 'defect' && drives(card));
    }
    return effectAt(tool, place) !== null;
  }

  function step(value) { return value == null ? 1 : value === 1 ? 0 : null; }

  /** Apply one click. Returns true if the circuit changed. */
  function click(card, tool, place) {
    if (!accepts(card, tool, place)) return false;
    if (tool === 'probe') {
      if (place.coin) { card.coin = step(card.coin); return true; }
      const next = step(card.when[place.pos] ? card.when[place.pos][place.feature] : null);
      if (next === null) {
        delete card.when[place.pos][place.feature];
        if (Object.keys(card.when[place.pos]).length === 0) delete card.when[place.pos];
      } else {
        if (!card.when[place.pos]) card.when[place.pos] = {};
        card.when[place.pos][place.feature] = next;
      }
      return true;
    }
    const effect = effectAt(tool, place);
    card.then = card.then === effect ? null : effect;
    if (drives(card) && card.when.here) {
      delete card.when.here.defect;            // implied from now on
      if (Object.keys(card.when.here).length === 0) delete card.when.here;
    }
    return true;
  }

  const TURNS = ['none', 'all', 'all+signals'];

  /** The symmetry button: on to the next of the settings the level offers, round and round. */
  function turn(card, options) {
    const list = options && options.length ? options : TURNS;
    card.turn = list[(list.indexOf(card.turn) + 1) % list.length];
    return true;
  }

  /**
   * Take the circuit at place `from` out of the machine and put it back so
   * that it ends up at place `to`. Returns the place it ended up at.
   */
  function move(rule, from, to) {
    if (from < 0 || from >= rule.length) return from;
    const target = Math.max(0, Math.min(rule.length - 1, to));
    if (target !== from) rule.splice(target, 0, rule.splice(from, 1)[0]);
    return target;
  }

  /**
   * Where a circuit dragged along the rack would land. `others` are the boxes
   * of the circuits that stay, in order, as { left, top, right, bottom }; the
   * rack reads like text, left to right and then down. Returns how many of
   * them come before the pointer: the place the dragged circuit would take.
   */
  function landing(others, x, y) {
    let before = 0;
    for (const box of others) {
      if (y > box.bottom || (y >= box.top && x > (box.left + box.right) / 2)) before++;
    }
    return before;
  }

  /**
   * The changes made to a machine, to step back and forth through. A state is
   * a string (the machine written out). `record` notes the state after a
   * change; whatever had been undone is then gone for good.
   */
  function history(limit) {
    const most = limit || 200;
    let past = [], future = [], now = null;
    return {
      reset(state) { past = []; future = []; now = state; },
      record(state) {
        if (state === now) return false;
        if (now !== null) past.push(now);
        if (past.length > most) past.shift();
        future = [];
        now = state;
        return true;
      },
      undo() {
        if (!past.length) return null;
        future.push(now);
        now = past.pop();
        return now;
      },
      redo() {
        if (!future.length) return null;
        past.push(now);
        now = future.pop();
        return now;
      },
      canUndo() { return past.length > 0; },
      canRedo() { return future.length > 0; },
      current() { return now; },
    };
  }

  /** The first place at which two machines differ: where to look after stepping from one to the other. */
  function firstDifference(a, b) {
    const n = Math.min(a.length, b.length);
    for (let k = 0; k < n; k++) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return k;
    return a.length === b.length ? 0 : n;
  }

  return { blank, accepts, click, turn, move, landing, history, firstDifference };
});
