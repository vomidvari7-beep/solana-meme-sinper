import { fakeDataReason, mlStop, planTriggerHit, planUsable, quoteImpact, scalpEntryFail, scalpSizeUsd, scalpStopLevel, textHasRugFlag } from './rules.js';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL ' + msg); process.exit(1); }
}

const book = { blacklist: {}, degenPicks: [{ mint: 'Laz', confidence: 0, reason: 'AVOID: rugged' }], agentRows: { Rug: [{ notes: 'rugged yesterday' }], Ok: [{ safety: 'RugCheck score 1, warnings none' }] } };
assert(fakeDataReason('Laz', {}, book).startsWith('fake-data'), 'avoid');
assert(fakeDataReason('Rug', {}, book) === 'fake-data: rug flag', 'rug flag');
assert(fakeDataReason('Ok', { m5b: 10, m5s: 0 }, book) === 'fake-data: m5 sells 0', 'zero sells');
assert(fakeDataReason('Ok', { liq: 1_600_000, vol24: 1000 }, book).includes('20x'), 'liq vs volume');
assert(fakeDataReason('Ok', { liq: 50_000, vol24: 200_000, m5b: 20, m5s: 10 }, book) === '', 'clean tape');
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

console.log('selftest ok');
