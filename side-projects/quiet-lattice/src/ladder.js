/*
 * Quiet Lattice — what a leaderboard needs: ranking, the moment and the place
 * of a solve, a name for this browser, and the packing of the stored rules.
 *
 * Packing keeps the stored rules out of plain sight until a level is solved.
 * It is not encryption: the page that unpacks them is the page that holds
 * them, so anyone who reads this file can do the same.
 */
(function (root, factory) {
  const ladder = factory();
  if (typeof module === 'object' && module.exports) module.exports = ladder;
  else root.QL.ladder = ladder;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- packing

  /** A stream of bytes that depends on the level only. */
  function stream(id, length) {
    const text = 'quiet-lattice/' + id;
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    let x = (h >>> 0) || 1;
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      out[i] = x & 255;
    }
    return out;
  }

  function pack(id, value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const key = stream(id, bytes.length);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] ^ key[i]);
    return btoa(binary);
  }

  function unpack(id, text) {
    const binary = atob(text);
    const key = stream(id, binary.length);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) ^ key[i];
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  // ---------------------------------------------------------------- ranking

  /**
   * What a leaderboard keeps of a verdict. A level that is one batch of random
   * lattices also keeps how many of them ended quiet.
   */
  function scoreOf(level, verdict) {
    const score = { cards: verdict.score.cards, bits: verdict.score.bits, ticks: verdict.score.ticks };
    if (level.cases.length === 1 && level.cases[0].random) {
      score.quiet = verdict.cases[0].counts.quiet;
      score.runs = verdict.cases[0].runs;
    }
    return score;
  }

  /** Better first: more lattices quiet, then fewer cards, fewer signals, fewer ticks. */
  function rank(a, b) {
    const x = a.score, y = b.score;
    if (x.quiet != null && y.quiet != null && x.quiet !== y.quiet) return y.quiet - x.quiet;
    if (x.cards !== y.cards) return x.cards - y.cards;
    if (x.bits !== y.bits) return x.bits - y.bits;
    if (x.ticks === y.ticks) return 0;
    if (x.ticks == null) return 1;
    if (y.ticks == null) return -1;
    return x.ticks - y.ticks;
  }

  /** The order of a leaderboard: by rank, and among equals the one recorded first. */
  function compare(a, b) {
    return rank(a, b) || (Date.parse(a.at) - Date.parse(b.at)) || 0;
  }

  /** Place of every entry of a sorted list: equals share a place. */
  function places(sorted) {
    const out = [];
    for (let k = 0; k < sorted.length; k++) {
      out.push(k > 0 && rank(sorted[k - 1], sorted[k]) === 0 ? out[k - 1] : k + 1);
    }
    return out;
  }

  // ------------------------------------------------------------- when, where

  function two(n) { return String(n).padStart(2, '0'); }

  /** Now, as local time with its offset, and the name of the time zone. */
  function stamp(date) {
    const d = date || new Date();
    const offset = -d.getTimezoneOffset();
    const at = d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate())
      + 'T' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds())
      + (offset < 0 ? '-' : '+') + two(Math.floor(Math.abs(offset) / 60)) + ':' + two(Math.abs(offset) % 60);
    let zone = '';
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (err) { zone = ''; }
    return { at, zone };
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /**
   * An entry's date and time as they were on the clock where it was recorded,
   * with the short name of that time zone, or its offset when it has none.
   */
  function when(entry) {
    const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::\d\d)?(Z|[+-]\d\d:\d\d)$/.exec(entry.at || '');
    if (!m) return { date: '', time: '', tz: '', zone: entry.zone || '', text: '' };
    const offset = m[6] === 'Z' ? '+00:00' : m[6];
    let tz = 'UTC' + (offset === '+00:00' ? '' : offset.replace('-', '\u2212'));
    if (entry.zone) {
      try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: entry.zone, timeZoneName: 'short' })
          .formatToParts(new Date(entry.at));
        const name = parts.find(function (p) { return p.type === 'timeZoneName'; });
        if (name && !/^(GMT|UTC)/.test(name.value)) tz = name.value;
      } catch (err) { /* an unknown zone name: keep the offset */ }
    }
    const date = Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
    const time = m[4] + ':' + m[5];
    return { date, time, tz, zone: entry.zone || '', text: date + ', ' + time + ' ' + tz };
  }

  // ------------------------------------------------------------------- who

  /**
   * A random name for this browser. It is made here from random bytes, says
   * nothing about the person or the device, and is the same on every visit
   * only because the page stores it.
   */
  function newId() {
    const bytes = new Uint8Array(8);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    let id = '';
    for (let i = 0; i < bytes.length; i++) id += two(bytes[i].toString(16));
    return id;
  }

  const FIRST = ['amber', 'brisk', 'calm', 'clear', 'crisp', 'dusky', 'early', 'faint',
    'gentle', 'hazy', 'idle', 'keen', 'level', 'mellow', 'narrow', 'north',
    'pale', 'plain', 'quick', 'quiet', 'rapid', 'round', 'sharp', 'slow',
    'soft', 'still', 'swift', 'tidy', 'vivid', 'warm', 'wide', 'young'];
  const SECOND = ['anchor', 'arrow', 'basin', 'beacon', 'bridge', 'canyon', 'cedar', 'comet',
    'coral', 'delta', 'ember', 'field', 'garnet', 'harbor', 'island', 'kernel',
    'lantern', 'lattice', 'meadow', 'mirror', 'orbit', 'pebble', 'prism', 'quartz',
    'ridge', 'river', 'signal', 'summit', 'tide', 'torus', 'valley', 'willow'];

  /** The id as two words and four characters, easier to tell apart than sixteen characters. */
  function nameOf(id) {
    if (!/^[0-9a-f]{16}$/.test(id || '')) return String(id || '');
    return FIRST[parseInt(id.slice(0, 2), 16) % FIRST.length] + '-'
      + SECOND[parseInt(id.slice(2, 4), 16) % SECOND.length] + '-' + id.slice(4, 8);
  }

  return { pack, unpack, scoreOf, rank, compare, places, stamp, when, newId, nameOf };
});
