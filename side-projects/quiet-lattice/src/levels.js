/*
 * Quiet Lattice — campaign.
 *
 * A rule is called a machine in the game, and its cards circuits. A case is a
 * fixed error pattern: `chains` are walks [y, x, steps] of flipped
 * edges, or `random` draws independent errors. A rule passes a level when
 * every run of every case ends quiet (no defects, no logical error) within
 * maxTicks, under every schedule the level lists. A level with `dark` also
 * asks that no signal is still lit at the end.
 *
 * `par` is the score of the best rule known to the authors. The rules
 * themselves are in src/board.js, packed, and shown once a level is solved.
 */
(function (root, factory) {
  const levels = factory();
  if (typeof module === 'object' && module.exports) module.exports = levels;
  else root.QL.levels = levels;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  return [
    {
      id: 'touch',
      name: 'Tutorial',
      L: 6,
      brief: [
        'Noise flips edges. Every chain of flipped edges ends in two defects, the solid dots, and the dots are all a site can see.',
        'A site sees itself and its four neighbours. Build one circuit: a driver with a probe, so that a defect is pushed onto a defect next to it. The pair cancels.',
      ],
      hint: 'Click a circle on the bench to put a probe there. Symmetry makes the circuit work in all four directions.',
      allow: { signals: 0, coin: false, cards: 4 },
      maxTicks: 20,
      cases: [
        { name: 'pair', chains: [[2, 2, 'E']] },
        { name: 'upright', chains: [[1, 4, 'S'], [4, 1, 'E']] },
        { name: 'row', chains: [[3, 1, 'E'], [3, 3, 'E']] },
        { name: 'block', chains: [[1, 1, 'E'], [2, 1, 'E']] },
        { name: 'edge', chains: [[4, 5, 'E']] },
      ],
      par: { cards: 1, bits: 0, ticks: 7 },
    },
    {
      id: 'gap',
      name: 'Gap',
      L: 10,
      brief: [
        'Two defects with a gap between them cannot see each other.',
        'Signals carry news further. An emitter lights a signal on its own site for one tick. It goes dark again unless some circuit keeps lighting it.',
      ],
      hint: 'The small coloured circles are signals. A probe on one needs it lit; an inverted probe needs it dark.',
      allow: { signals: 1, coin: false, cards: 6 },
      maxTicks: 60,
      cases: [
        { name: 'two apart', chains: [[4, 3, 'EE']] },
        { name: 'three apart', chains: [[2, 5, 'EEE']] },
        { name: 'around the edge', chains: [[6, 8, 'EEE']] },
        { name: 'two pairs', chains: [[2, 1, 'EE'], [7, 5, 'EEE']] },
        { name: 'mixed', chains: [[5, 6, 'E'], [3, 1, 'EE']] },
      ],
      par: { cards: 4, bits: 1, ticks: 21 },
    },
    {
      id: 'both',
      name: 'Both ways',
      L: 10,
      brief: [
        'The same news, along columns as well as rows. You have two signals.',
      ],
      allow: { signals: 2, coin: false, cards: 9 },
      maxTicks: 60,
      cases: [
        { name: 'row', chains: [[2, 5, 'EEE']] },
        { name: 'column', chains: [[3, 4, 'SSS']] },
        { name: 'around the edge', chains: [[8, 7, 'SSS']] },
        { name: 'one of each', chains: [[1, 1, 'EE'], [5, 6, 'SSS']] },
        { name: 'crossing', chains: [[4, 2, 'EEE'], [6, 7, 'SS']] },
      ],
      par: { cards: 7, bits: 2, ticks: 25 },
    },
    {
      id: 'far',
      name: 'Far',
      L: 12,
      brief: [
        'The lattice wraps around, and these pairs are almost half of it apart. News that travels the long way round arrives late and points the wrong way.',
        'If your moves join a pair the long way round, the lattice looks quiet but the loop winds around the torus. That is a logical error.',
        'Four signals now, and a new symmetry setting, “4-fold + signals”: each turned copy of a circuit uses the next signal. News going east, south, west and north then travels on a, b, c and d, and a site can tell which side it came from.',
      ],
      allow: { signals: 4, coin: false, cards: 10 },
      maxTicks: 80,
      cases: [
        { name: 'row', chains: [[3, 2, 'EEEEE']] },
        { name: 'column', chains: [[2, 7, 'SSSSS']] },
        { name: 'around the edge', chains: [[8, 9, 'EEEEE']] },
        { name: 'near and far', chains: [[2, 1, 'EEEE'], [7, 6, 'SSSSS']] },
      ],
      par: { cards: 4, bits: 4, ticks: 28 },
    },
    {
      id: 'diagonal',
      name: 'Diagonal',
      L: 12,
      brief: [
        'Partners that share neither a row nor a column. Let the news turn a corner.',
        'If both partners step toward each other at the same instant they can swap places forever. Something has to break the tie.',
      ],
      allow: { signals: 4, coin: false, cards: 12 },
      maxTicks: 80,
      cases: [
        { name: 'down right', chains: [[4, 4, 'ES']] },
        { name: 'down left', chains: [[4, 6, 'WS']] },
        { name: 'long step', chains: [[3, 3, 'EES']] },
        { name: 'tall step', chains: [[3, 8, 'WSS']] },
        { name: 'two by two', chains: [[5, 3, 'EESS']] },
        { name: 'bent', chains: [[4, 2, 'EESE']] },
        { name: 'three pairs', chains: [[1, 1, 'EE'], [5, 6, 'ES'], [9, 2, 'SS']] },
      ],
      par: { cards: 6, bits: 4, ticks: 40 },
    },
    {
      id: 'fade',
      name: 'Clean up',
      L: 10,
      brief: [
        'The defects are gone, but their signals are not: every site keeps passing them on. Old news misleads the next defect that sees it.',
        'Here a pattern counts only if the lattice ends quiet and dark: no defect, and no signal still lit. The bench has two new things. An absorber switches a signal off, even if an emitter lights it. And a coin, which a probe can read: such a circuit acts on heads only, about half the time.',
      ],
      hint: 'An absorber that always acts leaves no news at all. One that acts on heads lets a signal live only while something keeps lighting it.',
      allow: { signals: 4, coin: true, clear: true, cards: 14 },
      dark: true,
      seeds: 3,
      maxTicks: 60,
      cases: [
        { name: 'two apart', chains: [[4, 3, 'EE']] },
        { name: 'three apart', chains: [[2, 5, 'EEE']] },
        { name: 'column', chains: [[3, 4, 'SSS']] },
        { name: 'two pairs', chains: [[2, 1, 'EE'], [7, 5, 'SSS']] },
      ],
      par: { cards: 4, bits: 4, ticks: null },
    },
    {
      id: 'order',
      name: 'Any order',
      L: 10,
      brief: [
        'Until now every site updated at the same instant. Here sites update one at a time, in an order you do not choose: row by row, backwards, column by column, or at random. The rule must work in all of them.',
        'A signal can now cross the whole lattice in a single sweep, so timing means nothing. A signal that fades does not rely on timing.',
      ],
      hint: 'A probe on the coin lets a circuit act only on heads; an inverted probe, only on tails.',
      allow: { signals: 4, coin: true, clear: true, cards: 14 },
      schedules: ['raster', 'reverse', 'columns', 'shuffle', 'random'],
      seeds: 3,
      maxTicks: 150,
      cases: [
        { name: 'two apart', chains: [[4, 3, 'EE']] },
        { name: 'three apart', chains: [[2, 5, 'EEE']] },
        { name: 'column', chains: [[3, 4, 'SSS']] },
        { name: 'down right', chains: [[4, 4, 'ES']] },
        { name: 'long step', chains: [[3, 3, 'EES']] },
        { name: 'two pairs', chains: [[2, 0, 'EE'], [6, 5, 'SS']] },
      ],
      par: { cards: 6, bits: 4, ticks: null },
    },
    {
      id: 'rain',
      name: 'Rain',
      L: 12,
      brief: [
        'No more hand-made patterns. Every edge fails with probability 4 percent, on two hundred lattices. At least 185 must end quiet, with no logical error.',
        'Signals that outlive their defects mislead everyone else.',
      ],
      allow: { signals: 4, coin: true, clear: true, cards: 14 },
      maxTicks: 120,
      cases: [
        { name: 'rain', random: { p: 0.04, samples: 200, seed: 4242, need: 185 } },
      ],
      par: { cards: 6, bits: 4, ticks: null },
    },
  ];
});
