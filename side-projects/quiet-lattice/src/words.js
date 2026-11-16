/*
 * Quiet Lattice — a card, said in words.
 *
 * `card(card)` returns one sentence that means exactly what the card's picture
 * and switches mean, for the line shown on top of every card and in Help.
 */
(function (root, factory) {
  const words = factory();
  if (typeof module === 'object' && module.exports) module.exports = words;
  else root.QL.words = words;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const POS = ['here', 'E', 'W', 'S', 'N'];
  const SIGNALS = ['a', 'b', 'c', 'd'];
  const DIRECTION = { E: 'east', W: 'west', S: 'south', N: 'north' };

  function who(pos) { return pos === 'here' ? 'this site' : 'the ' + DIRECTION[pos] + ' neighbour'; }

  function list(items) {
    if (items.length < 2) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  /** The facts a card asks for, one short clause each, in a fixed order. */
  function facts(card) {
    const when = card.when || {};
    const move = String(card.then).indexOf('move') === 0;
    const out = [];
    if (card.coin === 1) out.push('the coin lands heads');
    if (card.coin === 0) out.push('the coin lands tails');
    for (const pos of POS) {
      const cond = when[pos] || {};
      // only a site that holds a defect can step, whatever the card says
      const defect = move && pos === 'here' ? 1 : cond.defect;
      if (defect === 1) out.push(who(pos) + ' has a defect');
      if (defect === 0) out.push(who(pos) + ' has no defect');
      for (const name of SIGNALS) {
        if (cond[name] === 1) out.push(who(pos) + '’s signal ' + name + ' is lit');
        if (cond[name] === 0) out.push(who(pos) + '’s signal ' + name + ' is dark');
      }
    }
    return out;
  }

  function effect(card) {
    const parts = String(card.then).split(':');
    if (parts[0] === 'move') return 'step ' + DIRECTION[parts[1]];
    return (parts[0] === 'clear' ? 'clear signal ' : 'light signal ') + parts[1];
  }

  function card(card) {
    if (card.then == null || card.then === '') {
      return 'No part that acts yet, so this circuit does nothing. Take a driver, an emitter or an absorber from the tray.';
    }
    const when = card.when || {};
    const move = String(card.then).indexOf('move') === 0;
    if (move && when.here && when.here.defect === 0) {
      return 'Never applies: a site without a defect cannot step.';
    }
    const clauses = facts(card);
    let text = (clauses.length ? 'When ' + list(clauses) : 'Always') + ': ' + effect(card) + '.';
    if (card.turn === 'all') text += ' The same in all four directions.';
    if (card.turn === 'all+signals') text += ' The same in all four directions; each turned copy uses the next signal.';
    return text;
  }

  return { card, facts, effect };
});
