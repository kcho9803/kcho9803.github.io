/*
 * Quiet Lattice — guided steps for the tutorial, the first signals and the cleanup level.
 *
 * A step shows a few sentences and, usually, one thing to do. `done` looks at
 * what the player has done so far and returns true once the step is complete;
 * the interface then moves on by itself. A step without `done` waits for the
 * Next button. `target` is a CSS selector of the control to point at, or a
 * function of the same things that returns one.
 *
 * What `done` and `target` receive:
 *   rule       the machine being built: its circuits, in order
 *   tick       ticks run on the pattern on screen
 *   result     null while running, then 'quiet', 'logical', 'open' or 'lit'
 *              ('lit': no defect left, but signals still on when time ran out)
 *   caseIndex  which test pattern is on screen
 *   runIndex   which run of that pattern (a pattern has several when chance is involved)
 *   pass       true once the machine clears every pattern of the level
 *   entryCards how many circuits the machine had when the step began
 *   selected   which circuit is on the bench
 *   tool       which part is in hand: 'probe', 'driver', 'emitter' or 'absorber';
 *              it stays in hand, so a step that needs another part points at the tray first
 */
(function (root, factory) {
  const coach = factory();
  if (typeof module === 'object' && module.exports) module.exports = coach;
  else root.QL.coach = coach;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Is there a circuit with this effect that has a probe for `feature` at `pos`? */
  function has(rule, then, pos, feature) {
    return rule.some(function (card) {
      return card.then === then && card.when[pos] && card.when[pos][feature] === 1;
    });
  }
  function hasEffect(rule, then) {
    return rule.some(function (card) { return card.then === then; });
  }
  function first(rule, test) {
    for (let k = 0; k < rule.length; k++) if (test(rule[k])) return k;
    return -1;
  }

  // where things are on the page
  function socket(pos, feature) { return '#bench .hit[data-pos="' + pos + '"][data-f="' + feature + '"]'; }
  function rail(dir) { return '#bench .hit[data-act="rail"][data-dir="' + dir + '"]'; }
  function tray(part) { return '#tray [data-tool="' + part + '"]'; }
  // the symmetry button steps through its settings: a guide points at it until the setting is right
  const SYMMETRY = '#bench .hit[data-act="turn"]';
  const COIN = '#bench .hit[data-f="coin"]';
  /** A control of circuit k: the circuit's place on the rack until it is on the bench. */
  function onBench(c, k, selector) {
    if (k < 0) return null;
    return c.selected === k ? selector : '#rack [data-sel="' + k + '"]';
  }
  /** A place that takes the part `part`: the tray first, until that part is in hand. */
  function withPart(c, part, selector) { return c.tool === part ? selector : tray(part); }
  /** Putting an emitter or an absorber on signal a of the newest circuit. */
  function mount(c, part) {
    return onBench(c, c.rule.length - 1, withPart(c, part, socket('here', 'a')));
  }

  const touch = {
    // the machine the tutorial starts from: a driver that pushes east
    start: [{ when: {}, coin: null, then: 'move:E', turn: 'none' }],
    steps: [
      {
        title: 'The goal',
        text: [
          'The grid is the lattice. Every short line is a qubit. Every crossing is a site.',
          'Noise has flipped one qubit: the thick line. All anyone can see of it are its two ends, where two <strong>defects</strong> sit. Those are the solid dots.',
          'The goal never changes: <strong>get rid of every defect.</strong> Then the lattice is quiet.',
        ],
      },
      {
        title: 'You build the machine',
        text: [
          'You never move a defect yourself. You build a small <strong>machine</strong>, and every site of the lattice runs a copy of it, all at the same moment, tick after tick.',
          'The machine is on the <strong>bench</strong>. The middle circle is a site, the four around it are its neighbours, and the lines between them are qubits. So far it has one part, a <strong>driver</strong>: the arrow. A driver pushes the defect on its site one place along the line it sits on, here to the east.',
          'The line above the bench says in words what the machine does, and <strong>Help</strong>, at the top of the page, explains every part.',
        ],
        action: 'Press <strong>Play</strong> and watch.',
        target: '#play',
        done: function (c) { return c.tick >= 4 || c.result !== null; },
      },
      {
        title: 'Add a probe',
        text: [
          'Both defects are pushed east, so they march side by side and never meet. When they leave on the right they come back on the left: the lattice wraps around.',
          'The driver fires too often. A <strong>probe</strong> makes it check a neighbouring site first.',
        ],
        action: 'On the bench, <strong>click the circle to the east of the middle</strong>. A probe appears on it: now the driver fires only if that site holds a defect.',
        target: function (c) { return withPart(c, 'probe', socket('E', 'defect')); },
        done: function (c) { return has(c.rule, 'move:E', 'E', 'defect'); },
      },
      {
        title: 'Try it',
        text: [
          'Now the line reads: <em>when this site has a defect and the east neighbour has a defect, step east.</em> Only the left defect fits. It is pushed onto its partner, and two defects on one site cancel.',
        ],
        action: 'Press <strong>Play</strong>.',
        target: '#play',
        done: function (c) { return c.result === 'quiet' || c.pass; },
      },
      {
        title: 'Every pattern',
        text: [
          'Quiet. The thick line turned grey: the driver flipped the same qubit the noise had flipped, which undoes it.',
          'A machine has to clear every pattern, not just this one. The names under the lattice are the test patterns. A filled dot means your machine clears that one.',
        ],
        action: '<strong>Click “upright”</strong> under the lattice.',
        target: '#cases .case:nth-child(2)',
        done: function (c) { return c.caseIndex === 1 || c.pass; },
      },
      {
        title: 'All four directions',
        text: [
          'One pair lies flat, the other stands upright. Press Play if you like: the flat pair cancels and the upright one stays, because neither of its defects has a neighbour to the <em>east</em>.',
          'You could build a second driver for south. There is a shortcut.',
        ],
        action: 'In the top right corner of the bench, <strong>click the symmetry button</strong>. It then reads “4-fold”: the driver and its probe work in all four directions, and the bench shows the turned copies faintly.',
        target: SYMMETRY,
        done: function (c) { return c.pass; },
      },
      {
        title: 'Solved',
        text: [
          'Every pattern goes quiet, including a crowd of four and a pair split across the edge of the lattice. Click any pattern and press Play to watch it.',
          'That is the whole game: say what a site must see, say what it does, and check it on every pattern.',
          'Two more things about probes. Clicking a circle a second time makes its probe <em>inverted</em> (struck through): no defect may be there. A third click takes the probe off.',
          '<strong>Undo</strong>, above the bench, takes back the last change to the machine, whatever it was.',
          '<strong>Leaderboard</strong>, next to the verdict, now lists the best machines known for this level, with yours among them. It opens for a level only once you have solved it.',
        ],
      },
    ],
  };

  const gap = {
    // used when the tutorial was skipped: a defect is pushed onto a neighbouring defect
    start: [{ when: { E: { defect: 1 } }, coin: null, then: 'move:E', turn: 'all' }],
    steps: [
      {
        title: 'A gap',
        text: [
          'Here the two defects have an empty site between them.',
        ],
        action: 'Press <strong>Play</strong>. Your driver from the tutorial does nothing, because neither defect has a neighbour.',
        target: '#play',
        done: function (c) { return c.tick >= 3 || c.result !== null; },
      },
      {
        title: 'Signals',
        text: [
          'A site sees only its four neighbours, so these two cannot see each other.',
          'Sites can pass news along with <strong>signals</strong>: small coloured lights that every site carries and its neighbours can see. There are four, called a, b, c and d. This level gives you one, a.',
          'A driver and its probes make one <strong>circuit</strong>. A machine can have several, and the next job needs a new one.',
        ],
        action: 'Press <strong>Add circuit</strong>.',
        target: '#add',
        done: function (c) { return c.rule.length >= 2; },
      },
      {
        title: 'An emitter',
        text: [
          'Every circuit needs one part that acts. A driver pushes a defect. An <strong>emitter</strong> lights a signal on its own site.',
          'The new circuit is still empty. The parts are in the tray above the bench. The one you take stays in your hand: a click puts it down where it fits, and a click on it takes it off again.',
        ],
        action: 'Take the <strong>Emitter</strong> from the tray, then <strong>click the small blue circle at the top right of the middle site</strong>.',
        target: function (c) { return mount(c, 'emitter'); },
        done: function (c) { return hasEffect(c.rule, 'light:a'); },
      },
      {
        title: 'Say when',
        text: [
          'The blue ring is the emitter. As it stands it would light a everywhere, all the time. Give it a probe.',
        ],
        action: 'Take the <strong>Probe</strong> from the tray again, then <strong>click the circle of the west site.</strong> The line now reads: <em>when the west neighbour has a defect, light signal a.</em>',
        target: function (c) {
          return onBench(c, first(c.rule, function (card) { return card.then === 'light:a'; }),
            withPart(c, 'probe', socket('W', 'defect')));
        },
        done: function (c) { return has(c.rule, 'light:a', 'W', 'defect'); },
      },
      {
        title: 'See it',
        text: [
          'A blue dot will appear just east of each defect. That site is saying “there is a defect to my west”.',
          'A signal lasts one tick. It stays lit only because the emitter lights it again every tick.',
        ],
        action: 'Press <strong>Step</strong> twice.',
        target: '#step',
        done: function (c) { return c.tick >= 2 || c.result !== null; },
      },
      {
        title: 'Pass it on',
        text: [
          'One site of news is not enough to cross the gap. Let each site hand the signal to the next.',
          'The small circles around every site of the bench are that site’s signals. Signal a is the blue one at the top right.',
        ],
        action: '<strong>Add a circuit and put an emitter on a, as before. Then take the probe and click the small blue circle of the west site.</strong> It reads: <em>when the west neighbour’s signal a is lit, light signal a.</em>',
        target: function (c) {
          if (c.rule.length <= c.entryCards) return '#add';
          const k = c.rule.length - 1;
          if (c.rule[k].then !== 'light:a') return mount(c, 'emitter');
          return onBench(c, k, withPart(c, 'probe', socket('W', 'a')));
        },
        done: function (c) { return has(c.rule, 'light:a', 'W', 'a'); },
      },
      {
        title: 'Watch it travel',
        text: [
          'The signal now runs east from each defect, one site per tick.',
        ],
        action: 'Press <strong>Play</strong>.',
        target: '#play',
        done: function (c) { return c.tick >= 4 || c.result !== null; },
      },
      {
        title: 'Act on it',
        text: [
          'The news arrives, but nobody acts on it yet. A defect that sees a arriving from the west knows someone is out there to its west.',
        ],
        action: '<strong>Add a third circuit. Take the Driver from the tray and click the line to the west of the middle, so that it pushes west. Then take the probe and click the small blue circle of the west site.</strong> It reads: <em>when this site has a defect and the west neighbour’s signal a is lit, step west.</em>',
        target: function (c) {
          if (c.rule.length <= c.entryCards) return '#add';
          const k = c.rule.length - 1;
          if (c.rule[k].then !== 'move:W') return onBench(c, k, withPart(c, 'driver', rail('W')));
          return onBench(c, k, withPart(c, 'probe', socket('W', 'a')));
        },
        done: function (c) { return has(c.rule, 'move:W', 'W', 'a'); },
      },
      {
        title: 'Run it',
        text: [
          'The right-hand defect walks west along the signal until it stands next to its partner. Then your first circuit finishes the job.',
        ],
        action: 'Press <strong>Play</strong> and watch it through.',
        target: '#play',
        // wait until the player has seen it work, not just until the machine is right
        done: function (c) { return c.pass && c.result === 'quiet'; },
      },
      {
        title: 'Solved',
        text: [
          'Every pattern under the lattice now goes quiet; click one and press Play to watch it.',
          'The next levels only name the new idea. The rest is yours.',
          '“Best known” under the verdict is the smallest machine the authors found. If you get stuck, the Sandbox lets you draw your own errors and watch what your machine does with them.',
        ],
      },
    ],
  };

  const NAMES = ['a', 'b', 'c', 'd'];

  function clearing(card) { return String(card.then).indexOf('clear') === 0; }
  /** Do the absorbers of a machine cover all four signals? */
  function clearsAll(rule) {
    const covered = {};
    for (const card of rule) {
      if (!clearing(card)) continue;
      if (card.turn === 'all+signals') return true;
      covered[card.then.split(':')[1]] = true;
    }
    return NAMES.every(function (name) { return covered[name]; });
  }
  function turnsSignals(card) { return card.turn === 'all+signals'; }
  function readsCoin(card) { return card.coin != null; }
  /** The first circuit with an absorber that fails `test`, or -1. */
  function absorberWithout(rule, test) {
    return first(rule, function (card) { return clearing(card) && !test(card); });
  }

  const fade = {
    // used when the level before was not solved: one ray per direction, on a, b, c and d
    start: [
      { when: { E: { defect: 1 } }, coin: null, then: 'move:E', turn: 'all' },
      { when: { W: { defect: 1 } }, coin: null, then: 'light:a', turn: 'all+signals' },
      { when: { W: { a: 1 } }, coin: null, then: 'light:a', turn: 'all+signals' },
      { when: { W: { a: 1 } }, coin: null, then: 'move:W', turn: 'all+signals' },
    ],
    steps: [
      {
        title: 'After the last defect',
        text: [
          'This machine already brings the pairs of this level together. The level is about what the machine leaves behind.',
          'From here the clock keeps running after the last defect is gone.',
        ],
        action: 'Press <strong>Play</strong>, and keep watching after the two defects have met.',
        target: '#play',
        done: function (c) { return c.tick >= 24 || c.result !== null; },
      },
      {
        title: 'Old news',
        text: [
          'The defects are gone. Their signals are not.',
          'Left alone, a signal lasts one tick: it is dark on the next tick unless an emitter lights it again. That is built in, and it is written above the machine.',
          'These signals survive because one of your circuits keeps lighting them. The circuit that passes a signal on lights it on the next site, and on the next, tick after tick, so the news keeps travelling round the lattice long after it stopped being true.',
        ],
      },
      {
        title: 'Why it matters',
        text: [
          'A signal says <em>there is a defect over there</em>. Once that defect is gone the signal is wrong, and the next defect that sees it steps the wrong way. When errors keep arriving, this is how a machine fails.',
          'So here a pattern counts only if the lattice ends <strong>quiet and dark</strong>: no defect, and no signal lit.',
        ],
      },
      {
        title: 'An absorber',
        text: [
          'Until now a circuit could only light a signal. From this level on the tray holds a new part, the <strong>absorber</strong>: it switches a signal off for the next tick, even if an emitter lights it.',
          'That is the tool for cleaning up.',
        ],
        action: '<strong>Add a circuit</strong>, take the <strong>Absorber</strong> from the tray, and <strong>click the small blue circle of the middle site</strong>.',
        target: function (c) {
          if (c.rule.length <= c.entryCards) return '#add';
          return mount(c, 'absorber');
        },
        done: function (c) { return c.rule.some(clearing); },
      },
      {
        title: 'All four signals',
        text: [
          'The dashed ring is the absorber. So far it clears only a, and this machine also uses b, c and d.',
        ],
        action: 'In the top right corner of the bench, <strong>click the symmetry button until it reads “4-fold + signals”</strong>: two clicks from “none”. The three turned copies, shown faintly, then clear b, c and d.',
        target: function (c) { return onBench(c, absorberWithout(c.rule, turnsSignals), SYMMETRY); },
        done: function (c) { return clearsAll(c.rule); },
      },
      {
        title: 'Too much',
        text: [
          'This circuit has no probe, so it acts on every site, on every tick. The line above the bench says so: <em>Always: clear signal a.</em>',
        ],
        action: 'Press <strong>Play</strong> and see what that does.',
        target: '#play',
        done: function (c) { return c.tick >= 8 || c.result !== null; },
      },
      {
        title: 'Only sometimes',
        text: [
          'Nothing is ever lit now. The lattice is dark, and the two defects never hear from each other. Cleaning up all the time leaves no news at all.',
          'Cleaning up <em>some</em> of the time is enough.',
          'Every site flips a coin on every tick, and a probe can read it. The coin sits in the corner of the bench.',
        ],
        action: 'With the absorber’s circuit on the bench, <strong>take the Probe from the tray and click the coin</strong>. An H appears on it: the circuit now acts only on heads, about half the time.',
        target: function (c) { return onBench(c, absorberWithout(c.rule, readsCoin), withPart(c, 'probe', COIN)); },
        done: function (c) { return clearsAll(c.rule) && absorberWithout(c.rule, readsCoin) < 0; },
      },
      {
        title: 'Watch it fade',
        text: [
          'Why this works: a signal has to be lit again on every tick, and now the absorber undoes that on every heads. Next to a defect the emitter always fires, so the signal is there half the time. One site further on it also needs the first site to have had it: a quarter of the time. Every further site halves it again.',
          'So news still gets through while a defect is there, only later and not as far. Once the defects have met, the first site is never lit again, and what is left runs out, usually within a few ticks.',
        ],
        action: 'Press <strong>Play</strong> and watch it through.',
        target: '#play',
        done: function (c) { return c.result === 'quiet'; },
      },
      {
        title: 'Every run is different',
        text: [
          'With a coin no two runs are the same. Each pattern is therefore tried three times with different coins, and every run must end quiet and dark.',
          '“run 1 of 3” under the lattice steps through the runs of the pattern on screen. If a run fails, “Show a failure” takes you to it.',
        ],
        action: 'Press <strong>›</strong> under the lattice to watch another run of this pattern.',
        target: '#runs',
        // wait until the player has looked at a second run, not just until the machine is right
        done: function (c) { return c.pass && c.runIndex > 0; },
      },
      {
        title: 'Solved',
        text: [
          'That is message cleanup: every signal you send has to end some time after the thing it reports.',
          'Absorbing at random is the bluntest way, and it costs reach: the further apart two defects are, the longer they wait to hear from each other.',
          'An absorber can be more careful. Give its circuit probes and it clears only where you say, for example not right next to a defect. The coin also works in other circuits: “Best known” under the verdict needs four circuits, because it puts the coin probe into the circuit that passes a signal on instead of adding a circuit.',
          'The Sandbox can keep noise falling, which shows quickly whether old signals pile up.',
        ],
      },
    ],
  };

  return { touch, gap, fade };
});
