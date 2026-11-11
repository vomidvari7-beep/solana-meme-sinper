import { degenLossPct, degenPotLimits, fakeDataReason, h1BreakSignal, h1TrendHold, mlStop, planTriggerHit, planUsable, quoteImpact, scalpEntryFail, scalpExitReason, scalpSizeUsd, scalpStopLevel, textHasRugFlag } from './rules.js';
import { evaluateSetup } from './setup.js';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL ' + msg); process.exit(1); }
}

const book = { blacklist: {}, degenPicks: [{ mint: 'Laz', confidence: 0, reason: 'AVOID: rugged' }], agentRows: { Rug: [{ notes: 'rugged yesterday' }], Ok: [{ safety: 'RugCheck score 1, warnings none' }] } };
assert(fakeDataReason('Laz', {}, book).startsWith('fake-data'), 'avoid');
assert(fakeDataReason('Rug', {}, book) === 'fake-data: rug flag', 'rug flag');
assert(fakeDataReason('Ok', { m5b: 10, m5s: 0 }, book) === 'fake-data: m5 sells 0', 'zero sells');
assert(fakeDataReason('Ok', { liq: 1_600_000, vol24: 1000 }, book).includes('20x'), 'liq vs volume');
assert(fakeDataReason('Ok', { liq: 50_000, vol24: 200_000, m5b: 20, m5s: 10 }, book) === '', 'clean tape');
assert(fakeDataReason('J7udkHVALc6MMjgQcFAHq2E81ohq1ZGb1APcDpv7pump', {}, { blacklist: { J7udkHVALc6MMjgQcFAHq2E81ohq1ZGb1APcDpv7pump: { why: 'rugged' } }, degenPicks: [], agentRows: {} }) === 'fake-data: blacklisted rug', 'seed rug');
assert(!textHasRugFlag('RugCheck danger: Single holder ownership'), 'rugcheck is not a rug flag');
assert(quoteImpact({}).reason.startsWith('fake-data'), 'missing quote');
assert(quoteImpact({ outAmount: '1' }).reason.includes('impact'), 'missing impact');
assert(quoteImpact({ outAmount: '1', priceImpactPct: '0.001' }).pct === 0.1, 'impact pct');

const led = { ledgers: { scalp: { startUsd: 100, balanceUsd: 100, realizedUsd: 0, trades: [] } } };
const first = scalpSizeUsd(led, [], () => 1);
assert(Math.abs(first.usd - 50) < 1e-9, 'half ledger');
const second = scalpSizeUsd(led, [{ open: true, mode: 'scalp', mint: 'A', avgUsd: 1 }], () => 1.1);
assert(second.usd > 90, 'remainder after a winner');
const blocked = scalpSizeUsd(led, [{ open: true, mode: 'scalp', mint: 'A', avgUsd: 1 }], () => 0.9);
assert(blocked.usd === 0, 'second only at breakeven');

const stop = scalpStopLevel(1, 0.98, 1, 1, false);
assert(stop.stop <= 0.98 && stop.stop >= 0.97, 'chart stop inside -3%');
assert(scalpEntryFail({ ageH: 1 }).includes('2h'), 'age filter');
assert(mlStop(1, 0.9) === 0.9 * 0.985, 'break stop 1.5% under the candle');
assert(mlStop(1, 0.5) === 0.85, 'break stop cap -15%');
assert(planUsable({ status: 'ready', confidence: 60, ts: Date.now(), trigger_price: 1 }), 'plan conf');
assert(!planUsable({ status: 'ready', confidence: 59, ts: Date.now() }), 'plan conf floor');
assert(planTriggerHit({ entry_mode: 'above', trigger_price: 1 }, 1.01), 'zone touch');

const now = 1_000_000;
const open = { code: 'abcd', exp: now + 1000, fails: 0, hits: [] };
assert(evaluateSetup(open, 'abcd', now, '1.1.1.1').ok, 'setup code ok');
assert(!evaluateSetup({ ...open, exp: now - 1 }, 'abcd', now, '1.1.1.1').ok, 'setup expired');
assert(!evaluateSetup({ done: true }, 'abcd', now, '1.1.1.1').ok, 'setup closed');
let locked = { code: 'abcd', exp: now + 1000, fails: 0, hits: [] };
for (let i = 0; i < 5; i++) locked = evaluateSetup(locked, 'nope', now, '9.9.9.9').row;
assert((locked.lockedUntil || 0) > now, 'setup rate limit');

function swordcatCandles() {
  const HOUR = 3600e3;
  const breakT = Date.parse('2026-11-11T15:00:00Z');
  const t0 = breakT - 39 * HOUR;
  const cs = [];
  for (let i = 0; i < 40; i++) {
    const t = t0 + i * HOUR;
    let o = 0.0009, h = 0.00092, l = 0.00088, c = 0.0009, v = 100;
    if (i === 5) { o = 0.00105; h = 0.0012; l = 0.001; c = 0.00108; }
    else if (i === 8) { o = 0.000955; h = 0.00097; l = 0.00093; c = 0.000955; }
    else if (i === 9) { o = 0.000985; h = 0.001; l = 0.00096; c = 0.000985; }
    else if (i === 11) { o = 0.001005; h = 0.00102; l = 0.00098; c = 0.001005; }
    else if (i === 12) { o = 0.001; h = 0.00105; l = 0.00096; c = 0.00098; }
    else if (i === 18) { o = 0.0009; h = 0.0009; l = 0.00075; c = 0.00078; }
    else if (i === 20) { o = 0.0009; h = 0.00096; l = 0.00082; c = 0.00086; }
    else if (i > 20 && i < 39) { o = 0.00085; h = 0.0009; l = 0.00082; c = 0.00086; }
    else if (i === 39) { o = 0.000841; h = 0.00103; l = 0.000833; c = 0.00103; v = 120; }
    cs.push({ t, o, h, l, c, v });
  }
  return { cs, now: breakT + 20 * 60e3, live: 0.00103 };
}
const sword = swordcatCandles();
const brk = h1BreakSignal(sword.cs, sword.now, sword.live);
assert(brk.buy, 'swordcat buys intra-candle');
assert(Math.abs(brk.entry - sword.live) < 1e-12, 'swordcat entry is the first price above the box');
assert(brk.entry > brk.line && brk.entry > brk.zoneHi, 'swordcat entry clears trendline and resistance');
assert(Math.abs(brk.stop - 0.000833 * 0.985) < 1e-12, 'swordcat stop is 1.5% under the forming low');
assert(brk.stop < brk.entry * 0.85, 'swordcat stop is wider than 15% and is not capped');
assert(brk.zoneLo >= 0.00094 && brk.zoneLo <= 0.00098 && brk.zoneHi >= 0.001 && brk.zoneHi <= 0.00103, 'swordcat zone is the old 0.00095-0.00102 box');
const inside = sword.cs.map(c => ({ ...c }));
inside[39] = { ...inside[39], h: 0.00099, c: 0.00099, v: 150 };
const poke = h1BreakSignal(inside, sword.now, 0.00099);
assert(!poke.buy, 'JEANPHIL poke into the box does not buy');
assert(poke.line > 0 && poke.line < 0.00099 && poke.zoneHi > 0.00099, 'JEANPHIL is above the trendline and still under the box top');
const dry = sword.cs.map(c => ({ ...c }));
dry[39] = { ...dry[39], v: 10 };
assert(!h1BreakSignal(dry, sword.now, sword.live).buy, 'a wick with no volume does not buy');
assert(h1BreakSignal(dry, sword.now, sword.live, { mult: 2 }).buy, 'a 2x short-term volume spike can confirm the cross');
const oldScalp = { avgUsd: 1, firstTs: Date.now() - 11 * 60e3, plan: { breakLow: 0.98 }, prot: { high: 1, runner: false, entryLiq: 1000 } };
assert(scalpExitReason(oldScalp, 0.99, [], { liq: 1000 }) === 'no +1.5% in 4m', 'regular scalp time stop stays');
const h1pos = { avgUsd: 0.001087, firstTs: Date.now() - 20 * 60e3, plan: { kind: 'breakout1h', stop: 0.000833 * 0.985 }, prot: { entryLiq: 1000, high: 0.001087 } };
assert(scalpExitReason(h1pos, 0.001, [], { liq: 1000 }) === '', 'breakout1h has no time stop');
assert(scalpExitReason(h1pos, 0.0008, [], { liq: 1000 }) === 'breakout stop', 'breakout1h uses the candle stop');
assert(scalpExitReason(h1pos, 0.001, [], { liq: 400 }) === 'liquidity pull', 'breakout1h still exits a liquidity pull');

function batonCandles(hold2) {
  const HOUR = 3600e3;
  const t0 = Date.parse('2026-11-11T00:00:00Z');
  const cs = [];
  for (let i = 0; i < 39; i++) {
    const t = t0 + i * HOUR;
    let o = 0.0009, h = 0.00092, l = 0.00088, c = 0.0009, v = 100;
    if (i === 5) { o = 0.00105; h = 0.0012; l = 0.001; c = 0.00108; }
    else if (i === 12) { o = 0.001; h = 0.00105; l = 0.00096; c = 0.00098; }
    else if (i === 20) { o = 0.0009; h = 0.00096; l = 0.00082; c = 0.00086; }
    else if (i > 20 && i < 36) { o = 0.00085; h = 0.0009; l = 0.00082; c = 0.00086; }
    else if (i === 36) { o = 0.0007; h = 0.0009; l = 0.00068; c = 0.00085; v = 200; }
    else if (i === 37) { o = 0.00084; h = 0.00088; l = 0.00078; c = 0.0008; v = 100; }
    else if (i === 38) { o = 0.00079; h = 0.00086; l = 0.00076; c = hold2; v = 100; }
    cs.push({ t, o, h, l, c, v });
  }
  return { cs, now: t0 + 38 * HOUR + HOUR + 1000 };
}
const baton = batonCandles(0.00078);
const held = h1TrendHold(baton.cs, baton.now);
assert(held.buy && held.kind === 'trendhold1h', 'baton hold buys after two closes above the line');
assert(Math.abs(held.entry - 0.00078) < 1e-12, 'baton entry is the second hold close');
assert(Math.abs(held.stop - 0.00068 * 0.985) < 1e-12, 'baton stop is under the break candle');
assert(Math.abs(held.stop - held.entry * 0.85) > 1e-8, 'baton stop is not moved to the 15% cap');
const lost = batonCandles(0.0005);
assert(!h1TrendHold(lost.cs, lost.now).buy, 'baton cancels when a hold closes back below the line');
const early = h1TrendHold(baton.cs.filter(c => c.t < Date.parse('2026-11-11T00:00:00Z') + 38 * 3600e3), baton.now);
assert(!early.buy, 'baton does not buy before the second hold closes');

assert(degenLossPct(8) === 12 && degenLossPct(40) === 25 && degenLossPct(18) === 18, 'stop clamp');
assert(degenPotLimits({ per_trade_usd: 20, max_open: 5, budget_usd: 40 }).tradeUsd === 12.5, 'pot cannot loosen size');
assert(degenPotLimits({ per_trade_usd: 8, max_open: 1, budget_usd: 10 }).maxOpen === 1, 'pot can tighten');
assert(degenPotLimits({}).budgetUsd === 25 && degenPotLimits(null).maxOpen === 2, 'pot defaults');
console.log('selftest ok');
