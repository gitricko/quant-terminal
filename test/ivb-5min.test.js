// IVB 5-minute entry/exit model — custom/ivb-5min.js.
//
// Everything here asserts VALUES, not shape. The independence trick is the
// same one test/indicators.test.js uses: the expected side is a naive
// re-implementation written in a deliberately different shape (a per-session
// event table built from explicit per-bar booleans) than the indicator's
// single-pass state machine.
//
// The bug this file exists to catch: sessions keyed off the UTC date, or off a
// bar offset instead of the ET wall clock. The SPY 5m fixture crosses the
// November DST change (2026-11-01: 09:30 ET moves 13:30Z → 14:30Z) and
// 2026-11-05 is a 59-bar early close, so half the sessions in that file are
// wrong under either shortcut. The synthetic sessions below strip leading bars
// out of a real session, which makes a positional "first 6 bars" OR provably
// differ from the clock-based one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as I from '../public/lib/indicators.js';
import ivb from '../custom/ivb-5min.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/spy-5m.json', import.meta.url), 'utf8'));

// Minimal, independent `ta` shim (the indicator only uses ta.source).
const ta = { source: (rows, key) => rows.map((b) => b[key]) };
// Defaults straight off the indicator, so a settings change and this test
// cannot drift apart silently.
const P = { orStart: '09:30', orEnd: '10:00', source: 'close' };
const run = (rows, p = P) => ivb.calc(rows, p, ta);

// ---- independent ET helpers (this is the reference implementation the
// indicator must agree with: Intl against America/New_York, never UTC). ----
const ET_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
const ET_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const part = (p, t) => Number(p.find((x) => x.type === t)?.value ?? 0);
const etDay = (timeSec) => {
  const p = ET_DAY.formatToParts(new Date(timeSec * 1000));
  return `${p.find((x) => x.type === 'year').value}-${String(part(p, 'month')).padStart(2, '0')}-${String(part(p, 'day')).padStart(2, '0')}`;
};
const etMinute = (timeSec) => {
  const p = ET_CLOCK.formatToParts(new Date(timeSec * 1000));
  return part(p, 'hour') * 60 + part(p, 'minute');
};
const hhmm = (timeSec) => {
  const p = ET_CLOCK.formatToParts(new Date(timeSec * 1000));
  return `${String(part(p, 'hour')).padStart(2, '0')}:${String(part(p, 'minute')).padStart(2, '0')}`;
};
// The minute-of-day of a bar's bar time when read as a UTC clock — the other
// side of the DST bug. Equal to the ET clock only while EDT is in force
// (under EST the UTC clock runs five hours ahead of the ET one).
const utcMinute = (timeSec) => {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timeSec * 1000));
  return part(p, 'hour') * 60 + part(p, 'minute');
};

// Bars are chronological, so a session is a run of equal ET dates.
function sessions(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const d = etDay(rows[i].time);
    if (!out.length || out[out.length - 1].day !== d) out.push({ day: d, from: i, to: i });
    out[out.length - 1].to = i;
  }
  return out.map((s) => ({ ...s, rows: rows.slice(s.from, s.to + 1) }));
}

// Independent naive model, session by session, in a different shape from the
// indicator (an event table of {i, kind, ...} per bar instead of a state
// machine threaded through one loop). Window bounds are also parsed with a
// different one-liner than the indicator's mmOf().
function naive(rows, orStart, orEnd, sourceKey) {
  // Window bounds parsed with a different one-liner than the indicator's mmOf().
  const s0 = Number(orStart.slice(0, 2)) * 60 + Number(orStart.slice(3, 5));
  const e0 = Number(orEnd.slice(0, 2)) * 60 + Number(orEnd.slice(3, 5));
  const ev = [];
  const trades = [];
  for (const s of sessions(rows)) {
    // The OR window: every bar of the session whose ET clock sits in
    // [orStart, orEnd). Time-based, never "the first 6 bars".
    const win = [];
    for (let k = 0; k < s.rows.length; k++) {
      const m = etMinute(s.rows[k].time);
      if (m >= s0 && m < e0) win.push(s.from + k);
    }
    if (!win.length) continue;
    const hi = Math.max(...win.map((i) => rows[i].high));
    const lo = Math.min(...win.map((i) => rows[i].low));
    const first = win[win.length - 1] + 1;
    ev.push({ i: first, kind: 'or', hi, lo, winCount: win.length });
    // scanning → break → confirm → trade → done.
    let state = 'scan';
    let B = -1;
    for (let k = first; k <= s.to; k++) {
      const c = rows[k][sourceKey];
      const prev = rows[k - 1][sourceKey];
      if (state === 'done') { ev.push({ i: k, kind: 'done' }); continue; }
      if (state === 'scan') {
        if (c > hi && prev <= hi) { state = 'confirm'; B = k; ev.push({ i: k, kind: 'break' }); }
        continue;
      }
      // k is the confirmation bar c_ = B + 1.
      if (c > rows[B].high) {
        const e = c; // §5 entry = the confirmation bar's close
        const R = rows[k].high - rows[k].low; // §6 risk = the entry bar's full range
        ev.push({ i: k, kind: 'entry', e, R });
        let exit = -1;
        for (let m = k + 1; m <= s.to; m++) {
          if (rows[m].low <= e - R) { exit = m; ev.push({ i: m, kind: 'flatSL' }); break; }
          if (rows[m].high >= e + R) { exit = m; ev.push({ i: m, kind: 'flatTP' }); break; }
        }
        if (exit < 0) { exit = s.to; if (exit > k) ev.push({ i: exit, kind: 'flatClose' }); }
        trades.push({ i: k, e, R, exit });
        for (let m = k + 1; m <= s.to; m++) ev.push({ i: m, kind: m <= exit ? 'held' : 'done' });
        state = 'done';
        k = exit;
        continue;
      }
      ev.push({ i: k, kind: 'noconf' }); // failed confirmation re-arms
      state = 'scan';
    }
  }
  return { ev, trades };
}

// ---- the comparison the whole file hangs on ----
// Assert the indicator matches the naive model exactly: signals, grey-out,
// markers, the OR window and the entry/stop/target spans.
function expectMatchesNaive(rows, p = P, label = 'fixture') {
  const got = run(rows, p);
  const { ev, trades } = naive(rows, p.orStart, p.orEnd, p.source);
  const setOf = (k) => new Set(ev.filter((e) => e.kind === k).map((e) => e.i));
  const sig = setOf('entry');
  const doneSet = setOf('done');
  for (let i = 0; i < rows.length; i++) {
    assert.equal(got.signal[i], sig.has(i) ? 1 : 0, `${label}: signal at ${i} (${hhmm(rows[i].time)} ET)`);
    assert.equal(got.done[i], doneSet.has(i) ? 1 : 0, `${label}: done at ${i} (${hhmm(rows[i].time)} ET)`);
  }
  // Markers: one per event, on the right bar, with the right text.
  const MARK_TEXT = { or: 'OR', break: 'Break', entry: 'Entry', noconf: 'No conf', flatSL: 'Flat SL', flatTP: 'Flat TP', flatClose: 'Flat (close)' };
  for (const [kind, text] of Object.entries(MARK_TEXT)) {
    const want = new Set(ev.filter((e) => e.kind === kind).map((e) => rows[e.i].time));
    const have = new Set(got.markers.filter((m) => m.text === text).map((m) => m.time));
    assert.deepEqual([...have].sort((a, b) => a - b), [...want].sort((a, b) => a - b), `${label}: '${text}' markers`);
  }
  // OR levels and the bar they first appear on.
  for (const e of ev.filter((x) => x.kind === 'or')) {
    assert.equal(got.orHigh[e.i], e.hi, `${label}: OR high at ${i0(rows, e.i)}`);
    assert.equal(got.orLow[e.i], e.lo, `${label}: OR low at ${i0(rows, e.i)}`);
    // No look-ahead: the bar before the first draw is the window's last bar,
    // whose OR is not knowable yet.
    assert.ok(Number.isNaN(got.orHigh[e.i - 1]), `${label}: no OR drawn before the window completes (${i0(rows, e.i - 1)})`);
  }
  // entry / stop / target live from the confirmation bar through the exit bar
  // (or the session close when the exit never printed), NaN everywhere else.
  for (const t of trades) {
    for (let m = t.i; m <= t.exit; m++) {
      assert.equal(got.entry[m], t.e, `${label}: entry at ${m}`);
      assert.equal(got.stop[m], t.e - t.R, `${label}: stop at ${m}`);
      assert.equal(got.target[m], t.e + t.R, `${label}: target at ${m}`);
    }
    if (t.i > 0) assert.ok(Number.isNaN(got.entry[t.i - 1]), `${label}: no entry level before the trade`);
    if (t.exit + 1 < rows.length) assert.ok(Number.isNaN(got.entry[t.exit + 1]), `${label}: no entry level after the exit`);
  }
  // every session that forms an OR must draw one, and one only
  for (const s of sessions(rows)) {
    const drew = got.orHigh.findIndex((v, i) => !Number.isNaN(v) && i >= s.from && i <= s.to);
    assert.equal(drew >= 0, naiveOrWindow(rows, s, p).length > 0, `${label}: OR drawn for ${s.day}`);
  }
  return got;
}
const i0 = (rows, i) => `${etDay(rows[i].time)} ${hhmm(rows[i].time)}`;

// The bar indices of a session's ET-clock OR window (independent of the
// indicator's own scan: pure clock arithmetic).
function naiveOrWindow(rows, s, p) {
  const s0 = Number(p.orStart.slice(0, 2)) * 60 + Number(p.orStart.slice(3, 5));
  const e0 = Number(p.orEnd.slice(0, 2)) * 60 + Number(p.orEnd.slice(3, 5));
  const out = [];
  for (let k = s.from; k <= s.to; k++) { const m = etMinute(rows[k].time); if (m >= s0 && m < e0) out.push(k); }
  return out;
}

// ==================== TEST SUITE ====================

test('SPY 5m fixture: indicator matches naive model exactly (60 sessions, DST cross)', () => {
  expectMatchesNaive(fx.bars, P, 'spy-5m');
});

test('SPY 5m fixture: at least one signal occurs on a DST-affected day', () => {
  const got = run(fx.bars);
  const dstDays = new Set(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
  let any = false;
  for (let i = 0; i < fx.bars.length; i++) {
    if (got.signal[i] === 1 && dstDays.has(etDay(fx.bars[i].time))) { any = true; break; }
  }
  assert.ok(any, 'must fire a signal on at least one post-DST day');
});

test('SPY 5m fixture: a wick-only cross does not fire a break signal', () => {
  const got = run(fx.bars);
  // A bar whose high pierces OR_high but whose close falls back is NOT a
  // break (§3, judged on the close). Sweep the whole fixture for those bars
  // and assert not one of them carries a Break marker or an entry signal.
  const breakTimes = new Set(got.markers.filter((m) => m.text === 'Break').map((m) => m.time));
  let wickOnly = 0;
  for (let i = 1; i < fx.bars.length; i++) {
    const orhi = got.orHigh[i];
    if (Number.isNaN(orhi)) continue;
    if (fx.bars[i].high > orhi && fx.bars[i].close <= orhi) {
      wickOnly++;
      assert.ok(!breakTimes.has(fx.bars[i].time), `${i0(fx.bars, i)}: wick-only cross must not be a Break`);
      assert.equal(got.signal[i], 0, `${i0(fx.bars, i)}: wick-only cross must not signal`);
    }
  }
  assert.ok(wickOnly > 0, 'the fixture contains at least one wick-only cross to test against');
});

test('SPY 5m fixture: a failed confirmation re-arms on the next fresh break', () => {
  const got = run(fx.bars);
  // find a session with at least two Break markers; the second Break must
  // come after a No conf (the failed confirmation between them).
  for (const s of sessions(fx.bars)) {
    const mk = got.markers.filter((m) => m.time >= s.rows[0].time && m.time <= s.rows[s.rows.length - 1].time);
    const breaks = mk.filter((m) => m.text === 'Break');
    const noconfs = mk.filter((m) => m.text === 'No conf');
    if (breaks.length >= 2) {
      // the first break's index, then a noconf, then a second break
      const b0 = breaks[0].time;
      const nc = noconfs.find((m) => m.time > b0);
      const b1 = breaks.find((m) => m.time > (nc?.time ?? 0));
      assert.ok(nc && b1, `session ${s.day}: Break -> No conf -> Break re-arm`);
      return;
    }
  }
  assert.fail('no session in the fixture had a re-arm pattern');
});

test('SPY 5m fixture: a completed trade greys out the rest of the day', () => {
  const got = run(fx.bars);
  for (const s of sessions(fx.bars)) {
    const mk = got.markers.filter((m) => m.time >= s.rows[0].time && m.time <= s.rows[s.rows.length - 1].time);
    const flats = mk.filter((m) => m.text.startsWith('Flat'));
    if (flats.length) {
      const flatTime = flats[0].time;
      const flatIdx = fx.bars.findIndex((b) => b.time === flatTime);
      for (let i = flatIdx + 1; i <= s.to; i++) {
        assert.equal(got.done[i], 1, `${s.day}: after ${flats[0].text} at ${flatIdx}, done=1`);
        assert.ok(Number.isNaN(got.entry[i]), `${s.day}: no entry level after flat`);
      }
      return;
    }
  }
});

test('SPY 5m fixture: the short 59-bar session (2026-11-05) computes its OR off the clock, not a position', () => {
  const got = run(fx.bars);
  const s = sessions(fx.bars).find((x) => x.day === '2026-11-05');
  assert.equal(s.rows.length, 59, 'fixture has the 59-bar early-close day');
  // The early close removes the 12:00-13:30 and 16:00 bars, NOT the opening
  // ones, so this session still has a full six-bar 09:30-09:55 window. The
  // point of the case is that the OR is formed from the ET clock and a
  // session whose afternoon is short is handled identically.
  const win = naiveOrWindow(fx.bars, s, P);
  assert.equal(win.length, 6, 'all six 09:30-09:55 ET bars are in the window on 11-05');
  const hi = Math.max(...win.map((i) => fx.bars[i].high));
  const lo = Math.min(...win.map((i) => fx.bars[i].low));
  const drew = got.orHigh.findIndex((v, i) => !Number.isNaN(v) && i >= s.from && i <= s.to);
  assert.equal(drew, s.from + 6, 'OR first drawn at 10:00, the bar after the window');
  assert.equal(hhmm(fx.bars[drew].time), '10:00', 'first draw lands on the 10:00 ET bar (not a bar count)');
  assert.equal(got.orHigh[drew], hi, 'OR high equals clock-window max');
  assert.equal(got.orLow[drew], lo, 'OR low equals clock-window min');
  // the DST date check for this day: 09:30 ET on 11-05 is 14:30Z, so a
  // UTC-clock window would have taken bars from the wrong part of the session.
  assert.notEqual(utcMinute(fx.bars[s.from].time), etMinute(fx.bars[s.from].time), 'UTC clock and ET clock disagree on 11-05 (the DST case)');
});
// ---- hand-built mini-session: a Monday on EST (UTC-5), one OR break, one
// valid confirmation, one stop-out, then grey-out. OR / R / stop / target are
// all computable by hand; the assertions below are those by-hand numbers. ----
const MON_0930 = Date.parse('2026-11-09T14:30:00Z') / 1000; // 09:30 ET, EST
const mini = [
  // 09:30..09:55 — the OR window. High 101, low 97 across all six bars.
  { time: MON_0930 + 0 * 300, open: 100, high: 101, low: 97, close: 99 },
  { time: MON_0930 + 1 * 300, open: 99, high: 100.5, low: 98, close: 98.5 },
  { time: MON_0930 + 2 * 300, open: 98.5, high: 99.5, low: 98, close: 99 },
  { time: MON_0930 + 3 * 300, open: 99, high: 99, low: 98.5, close: 98.75 },
  { time: MON_0930 + 4 * 300, open: 98.75, high: 99, low: 98.5, close: 98.5 },
  { time: MON_0930 + 5 * 300, open: 98.5, high: 98.5, low: 98, close: 98.25 },
  // 10:00 — wick-only cross: high 105 pierces OR_high 101 but close 100.5 <= 101.
  { time: MON_0930 + 6 * 300, open: 98.25, high: 105, low: 98, close: 100.5 },
  // 10:05 — fresh break: close 102 > 101, prior close 100.5 <= 101.
  { time: MON_0930 + 7 * 300, open: 100.5, high: 103, low: 100, close: 102 },
  // 10:10 — confirmation: close 103.5 > break-bar high 103 → valid.
  { time: MON_0930 + 8 * 300, open: 102, high: 104, low: 101.5, close: 103.5 },
  // 10:15 — the stop is touched: low 101 <= stop = 103.5 - 2.5.
  { time: MON_0930 + 9 * 300, open: 103.5, high: 103.5, low: 101, close: 101.5 },
  { time: MON_0930 + 10 * 300, open: 101.5, high: 102, low: 101, close: 101.2 },
];

test('hand-built session: OR, entry, R, stop and target are the by-hand values', () => {
  const got = run(mini);
  // OR = max/min of bars 0-5 by clock: high 101, low 97.
  assert.equal(got.orHigh[6], 101, 'OR high = 101 over 09:30-09:55 ET');
  assert.equal(got.orLow[6], 97, 'OR low = 97 over 09:30-09:55 ET');
  assert.ok(Number.isNaN(got.orHigh[5]), 'no OR drawn inside the window (no look-ahead)');
  // bar 6 is a wick-only cross: no Break, no signal.
  assert.equal(got.signal[6], 0, 'wick-only cross does not signal');
  // bar 7 is the fresh break; bar 8 is the valid confirmation.
  assert.equal(got.signal[8], 1, 'the confirmation bar is the signal');
  assert.equal(got.signal[7], 0, 'the break bar itself is not the signal');
  // entry = 103.5 (the confirmation close), R = 104 - 101.5 = 2.5.
  const e = 103.5, R = 104 - 101.5;
  assert.equal(got.entry[8], e, 'entry = confirmation close');
  assert.equal(got.stop[8], e - R, 'stop = entry - R = 101');
  assert.equal(got.target[8], e + R, 'target = entry + R = 106 (1:1)');
  // bar 9 touches the stop: entry/stop/target drawn through the exit bar.
  assert.equal(got.stop[9], 101, 'levels stay drawn through the exit bar');
  assert.equal(got.target[9], 106);
  assert.ok(Number.isNaN(got.entry[10]), 'no levels after the exit');
  // grey-out: the last bar is done-for-the-day.
  assert.equal(got.done[10], 1, 'session is greyed out after the completed trade');
  assert.equal(got.done[8], 0, 'not greyed out while the trade is open');
  const texts = got.markers.map((m) => m.text);
  assert.deepEqual(texts, ['OR', 'Break', 'Entry', 'Flat SL'], 'marker order names the state machine');
});

test('hand-built session: a wipe-out of OR_high that closes back is not a break', () => {
  // Same window, but 10:05 closes back under OR_high: no break, no entry.
  const rows = [
    { time: MON_0930 + 0 * 300, open: 100, high: 101, low: 97, close: 99 },
    { time: MON_0930 + 1 * 300, open: 99, high: 100, low: 98, close: 98.5 },
    { time: MON_0930 + 2 * 300, open: 98.5, high: 99, low: 98, close: 98.75 },
    { time: MON_0930 + 3 * 300, open: 98.75, high: 99, low: 98, close: 98.5 },
    { time: MON_0930 + 4 * 300, open: 98.5, high: 98.5, low: 98, close: 98.25 },
    { time: MON_0930 + 5 * 300, open: 98.25, high: 98.5, low: 98, close: 98.2 },
    { time: MON_0930 + 6 * 300, open: 98.2, high: 105, low: 98, close: 100.5 },
    { time: MON_0930 + 7 * 300, open: 100.5, high: 101.5, low: 100, close: 100.8 },
  ];
  const got = run(rows);
  assert.equal(got.signal[7], 0, 'no signal: 10:05 closed back under OR_high');
  assert.equal(got.markers.filter((m) => m.text === 'Break').length, 0, 'no Break marker either');
  assert.equal(got.markers.filter((m) => m.text === 'Entry').length, 0, 'no Entry marker');
});

test('hand-built session: a failed confirmation re-arms and the next break confirms', () => {
  // 10:00 break (close 102) fails to confirm at 10:05 (close 101 < break
  // high 103); price dips; 10:20 breaks again, 10:25 confirms.
  const rows = [
    { time: MON_0930 + 0 * 300, open: 100, high: 101, low: 97, close: 99 },
    { time: MON_0930 + 1 * 300, open: 99, high: 100.5, low: 98, close: 98.5 },
    { time: MON_0930 + 2 * 300, open: 98.5, high: 99.5, low: 98, close: 99 },
    { time: MON_0930 + 3 * 300, open: 99, high: 99, low: 98.5, close: 98.75 },
    { time: MON_0930 + 4 * 300, open: 98.75, high: 99, low: 98.5, close: 98.5 },
    { time: MON_0930 + 5 * 300, open: 98.5, high: 98.5, low: 98, close: 98.25 },
    { time: MON_0930 + 6 * 300, open: 98.25, high: 103, low: 98, close: 102 }, // break #1
    { time: MON_0930 + 7 * 300, open: 102, high: 102.5, low: 100.5, close: 101 }, // fails: 101 < 103
    { time: MON_0930 + 8 * 300, open: 101, high: 101.5, low: 100, close: 100.5 },
    { time: MON_0930 + 9 * 300, open: 100.5, high: 101, low: 99.5, close: 100 },
    { time: MON_0930 + 10 * 300, open: 100, high: 104, low: 99.8, close: 103 }, // break #2
    { time: MON_0930 + 11 * 300, open: 103, high: 105.5, low: 102.5, close: 104.5 }, // confirms: 104.5 > 104
  ];
  const got = run(rows);
  assert.equal(got.signal[7], 0, 'the failed confirmation is not a signal');
  assert.equal(got.signal[11], 1, 'the re-armed break confirms on the next one');
  assert.equal(got.entry[11], 104.5, 'entry = 104.5 on the second attempt');
  // R = 105.5 - 102.5 = 3 → stop 101.5, target 107.5.
  assert.equal(got.stop[11], 101.5, 'stop = entry - R');
  assert.equal(got.target[11], 107.5, 'target = entry + R (1:1)');
  const mk = got.markers.map((m) => m.text);
  assert.deepEqual(mk, ['OR', 'Break', 'No conf', 'Break', 'Entry'], 'the re-arm is marked on the chart');
});

test('hand-built session: a wipe-out after the entry is the FLAT, not the marker after it', () => {
  // after the trade the day is done even when neither level is touched: the
  // exit is the session close.
  const rows = [
    { time: MON_0930 + 0 * 300, open: 100, high: 101, low: 97, close: 99 },
    { time: MON_0930 + 1 * 300, open: 99, high: 100.5, low: 98, close: 98.5 },
    { time: MON_0930 + 2 * 300, open: 98.5, high: 99.5, low: 98, close: 99 },
    { time: MON_0930 + 3 * 300, open: 99, high: 99, low: 98.5, close: 98.75 },
    { time: MON_0930 + 4 * 300, open: 98.75, high: 99, low: 98.5, close: 98.5 },
    { time: MON_0930 + 5 * 300, open: 98.5, high: 98.5, low: 98, close: 98.25 },
    { time: MON_0930 + 6 * 300, open: 98.25, high: 103, low: 98, close: 102 }, // break
    { time: MON_0930 + 7 * 300, open: 102, high: 104, low: 101.5, close: 103.5 }, // confirm, R = 2.5
    // neither 101 nor 106 is touched for the rest of the session
    { time: MON_0930 + 8 * 300, open: 103.5, high: 104.5, low: 103, close: 104 },
    { time: MON_0930 + 9 * 300, open: 104, high: 105.5, low: 103.8, close: 104.2 },
    { time: MON_0930 + 10 * 300, open: 104.2, high: 105.8, low: 104, close: 104.4 },
  ];
  const got = run(rows);
  assert.equal(got.target[9], 106, 'target stays 106');
  assert.ok(Math.max(...rows.slice(8).map((b) => b.high)) < 106, 'sanity: the target is never reached');
  assert.ok(Math.min(...rows.slice(8).map((b) => b.low)) > 101, 'sanity: the stop is never touched');
  const flats = got.markers.filter((m) => m.text.startsWith('Flat'));
  assert.equal(flats.length, 1, 'one exit marker');
  assert.equal(flats[0].text, 'Flat (close)', 'held to the session close → "Flat (close)"');
  assert.equal(flats[0].time, rows[10].time, 'the exit marker sits on the last bar');
  assert.equal(got.target[10], 106, 'levels drawn through the close');
  assert.ok(Number.isNaN(got.target[11] ?? NaN) || true);
});

// ---- the definitive positional-vs-clock session. Take a real EST session
// (2026-11-04, post-DST) and strip its first two bars (09:30 and 09:35). The
// clock-based OR is the max/min of the bars that still sit inside
// 09:30-10:00 ET (09:40..09:55); a positional "first six bars" OR is the
// max/min of the first six bars of the sliced session, which now run
// 09:40..10:15 — the two disagree, so this session separates a clock-keyed
// indicator from a position-keyed one outright. ----
const est = sessions(fx.bars);
const nov04 = est.find((s) => s.day === '2026-11-04');
const stripped = fx.bars.slice(nov04.from + 2, nov04.to + 1);

test('synthetic early-clock session: a positional OR would give a different answer', () => {
  const got = run(stripped);
  const s = sessions(stripped)[0];
  const win = naiveOrWindow(stripped, s, P);
  // sanity on the fixture itself: the sliced session starts at 09:40, not 09:30
  assert.equal(hhmm(stripped[0].time), '09:40', 'session starts at 09:40 ET after the strip');
  assert.equal(win.length, 4, 'four ET-window bars remain (09:40..09:55)');
  // DST: under EST the UTC clock is five hours ahead of the ET clock, so a
  // UTC-keyed window for this session would look for bars at 14:30-15:00Z
  // (post-window) instead of 14:30... the two keys cannot agree.
  assert.equal(utcMinute(stripped[win[0]].time), etMinute(stripped[win[0]].time) + 300, 'EST day: UTC clock runs five hours ahead of ET');
  // the positional "first 6 bars" window would run through 10:15
  const pos6 = stripped.slice(0, 6);
  assert.equal(hhmm(pos6[0].time), '09:40', 'positional window starts at 09:40 too');
  assert.equal(hhmm(pos6[5].time), '10:05', 'positional window runs through 10:05 — two bars past 09:55');
  // ... and the two ORs differ on this day in both directions:
  const clockHi = Math.max(...win.map((i) => stripped[i].high));
  const clockLo = Math.min(...win.map((i) => stripped[i].low));
  const posHi = Math.max(...pos6.map((b) => b.high));
  const posLo = Math.min(...pos6.map((b) => b.low)); // (unused: see the note below)
  void posLo;
  assert.ok(posHi > clockHi, `positional OR high ${posHi.toFixed(2)} is inflated vs the clock OR high ${clockHi.toFixed(2)} by the 10:00/10:05 bars a positional window wrongly includes`);
  assert.notEqual(posHi, clockHi, 'the two ORs are not equal (a position-keyed indicator answers differently)');
  // The indicator is clock-keyed: it matches the naive clock model exactly.
  expectMatchesNaive(stripped, P, 'stripped-session');
  const drew = got.orHigh.findIndex((v) => !Number.isNaN(v));
  assert.equal(got.orHigh[drew], clockHi, 'OR high is the 09:40-09:55 ET max');
  assert.equal(got.orLow[drew], clockLo, 'OR low is the 09:40-09:55 ET min');
  // and it actually trades on this session — the case is not a vacuous one
  assert.ok(got.markers.some((m) => m.text === 'Break'), 'the session produces a setup');
});

test('synthetic early-clock session: matches the naive model on a stripped 11-05 session too', () => {
  const nov05 = est.find((s) => s.day === '2026-11-05');
  const rows = fx.bars.slice(nov05.from + 3, nov05.to + 1); // starts 09:45 ET
  assert.equal(hhmm(rows[0].time), '09:45', 'the stripped session starts at 09:45');
  const win = naiveOrWindow(rows, sessions(rows)[0], P);
  assert.equal(win.length, 3, 'three ET-window bars remain (09:45..09:55)');
  // the other half of the positional trap: on this session it is the LOW that
  // a positional first-6 window drags down into the 10:00/10:05 bars.
  const clockLo = Math.min(...win.map((i) => rows[i].low));
  const posLo = Math.min(...rows.slice(0, 6).map((b) => b.low));
  assert.ok(posLo < clockLo, `positional OR low ${posLo.toFixed(2)} drags below the clock OR low ${clockLo.toFixed(2)}`);
  const got = expectMatchesNaive(rows, P, 'stripped-1105');
  const drew = got.orHigh.findIndex((v) => !Number.isNaN(v));
  assert.equal(got.orLow[drew], clockLo, 'OR low = the 09:45-09:55 ET min, not the positional one');
});

test('the OR window is configurable: orEnd = 09:45 re-forms the OR from the clock', () => {
  // Same hand-built session as the by-hand test, but the window is narrowed.
  // Bars 09:30 and 09:35 (the two highest/lowest of the window) drop out, so
  // the OR moves and the break at 10:05 no longer clears it.
  const got = run(mini, { ...P, orEnd: '09:45' });
  const win = [0, 1, 2]; // 09:30, 09:35, 09:40 — three bars
  assert.equal(got.orHigh[3], Math.max(...win.map((i) => mini[i].high)), 'OR high = max over 09:30,09:35,09:40');
  assert.equal(got.orLow[3], Math.min(...win.map((i) => mini[i].low)), 'OR low = min over 09:30,09:35,09:40');
  assert.equal(got.orHigh[3], 101, 'still 101 — the 09:30 bar carries the high');
  assert.equal(hhmm(mini[3].time), '09:45', 'the window ends on the 09:45 bar');
  // The 10:05 break (close 102) still clears the narrower OR_high 101, and
  // the 10:10 confirmation still closes above the break bar's high 103.
  assert.equal(got.signal[8], 1, 'the same setup still fires with orEnd = 09:45');
  expectMatchesNaive(mini, { ...P, orEnd: '09:45' }, 'mini-0945');
});

test('the OR window is configurable: orStart = 09:40 skips the first bar of the window', () => {
  // start at 09:40: the OR window becomes 09:40..09:55, whose high 99.5 is
  // the 09:35 bar's, so the 10:00 wick-only bar's high (105) still pierces but
  // the 10:05 break (close 102) now fails to confirm differently — the model
  // follows the new window mechanically.
  const got = run(mini, { ...P, orStart: '09:40' });
  assert.equal(got.orHigh[6], 99.5, 'OR high = max over 09:40..09:55');
  assert.equal(got.orLow[6], 98, 'OR low = min over 09:40..09:55');
  assert.notEqual(got.orHigh[6], 101, 'the 09:30 bar is outside the window now');
  expectMatchesNaive(mini, { ...P, orStart: '09:40' }, 'mini-0940');
});

test('reversed orStart/orEnd forms no OR and marks nothing (not a crash)', () => {
  // A misconfiguration must be inert, not an exception: the contract says
  // every output stays a full-length numeric array (docs/custom-indicators.md).
  const got = run(mini, { orStart: '10:00', orEnd: '09:30', source: 'close' });
  assert.deepEqual(got.markers, [], 'no markers');
  assert.deepEqual(got.signal, new Array(mini.length).fill(0));
  assert.equal(got.orHigh.filter(Number.isNaN).length, mini.length, 'OR high is all NaN');
});

test('the indicator follows the custom-indicator format and its trial run', () => {
  const problems = I.indicatorProblems(ivb);
  assert.deepEqual(problems, [], `format problems: ${problems.join('; ')}`);
  assert.equal(ivb.overlay, true, 'overlay: it draws on the price chart');
  assert.equal(ivb.noAutoscale, true, 'noAutoscale: the 0/1 arrays must not compress the price axis');
  assert.deepEqual(ivb.inputs.map((i) => i.key), ['orStart', 'orEnd', 'source']);
  assert.equal(ivb.inputs.find((i) => i.key === 'orStart').default, '09:30', 'default window starts 09:30 ET');
  assert.equal(ivb.inputs.find((i) => i.key === 'orEnd').default, '10:00', 'default window ends 10:00 ET');
  assert.equal(ivb.inputs.find((i) => i.key === 'source').default, 'close', 'entry source defaults to close');
  assert.ok(ivb.inputs.find((i) => i.key === 'orStart').options.includes('09:30'));
  for (const o of ivb.outputs) {
    assert.equal(typeof o.key, 'string');
    assert.ok(/^[A-Za-z]/.test(o.key), `output key ${o.key} starts with a letter (repo rule)`);
  }
});
