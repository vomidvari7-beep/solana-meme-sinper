import { emaLast, isNum, lineAt, swingPoints, tehranDayKey, usd6 } from './util.js';

export const SCALP = {
  START_USD: 100, MIN_FREE: 5, MAX_OPEN: 2,
  LIQ_MIN: 50000, VOL24_MIN: 100000, AGE_MIN_H: 2, TOP10_MAX: 30, INSIDER_MAX: 20,
  M5_MIN: 1, M5_MAX: 10, H1_MAX: 60, BODY_MAX: 0.04, EMA20_MAX_ABOVE: 0.03, LAST3_MAX: 0.08,
  VOL_MULT: 2, FLOW: 1.2, BUYS_MIN: 15, IMPACT_MAX: 0.5, SLIP_BPS: 150, QUOTE_DRIFT: 0.01,
  SOL_15M_MIN: -1.5, SOL_1H_MIN: -3, STOP_PCT: 0.03, STOP_BUF: 0.003, STOP_TICKS: 2, STOP_MS: 5000,
  BE_ARM: 0.03, BE_STOP: 0.005, TIME_FLAT_MIN: 4, TIME_FLAT_NEED: 0.015, TIME_HARD_MIN: 10,
  RUNNER_AT: 0.05, TRAIL: 0.03, TRAIL_TIGHT: 0.02, TRAIL_TIGHT_AT: 0.15, FLOOR: 0.03, ROOM: 0.05,
  CD_LOSS_MS: 15 * 60e3, CD_WIN_MS: 60e3, MAX_PER_DAY: 3, LOSS_STREAK: 3, PAUSE_MS: 30 * 60e3, MAX_PAUSES: 2
};

export const CAPS = {
  maxSolPerTrade: 0.1, dailyMaxSol: 0.3, autoMaxSol: 0.05, autoDaily: 0.2,
  balancePct: 20, reserveSol: 0.01, maxOpen: 2, minBuySol: 0.001,
  degenStartUsd: 25, degenTradeUsd: 4, degenImpact: 15, listUsd: 5
};

export function textHasRugFlag(s) {
  return /\brugged\b|\brug[\s-]?pull\b|\brug\b/i.test(String(s || '').replace(/rugcheck/ig, ' '));
}

export function blobText(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(blobText).join(' ');
  if (typeof v === 'object') return Object.keys(v).map(k => k + ' ' + blobText(v[k])).join(' ');
  return '';
}

export function fakeDataReason(mint, tape, book) {
  const t = tape || {};
  const black = book?.blacklist || {};
  if (mint && black[mint]) return 'fake-data: blacklisted rug';
  const pick = (book?.degenPicks || []).find(p => p && p.mint === mint);
  if (pick && +pick.confidence === 0) return 'fake-data: confidence 0';
  if (pick && /\bAVOID\b/i.test(String(pick.reason || '') + ' ' + String(pick.status || ''))) return 'fake-data: AVOID';
  const rows = book?.agentRows?.[mint] || (pick ? [pick] : []);
  if (rows.some(row => textHasRugFlag(blobText(row)))) return 'fake-data: rug flag';
  if (isNum(t.m5b) && t.m5b > 0 && isNum(t.m5s) && t.m5s === 0) return 'fake-data: m5 sells 0';
  if (isNum(t.h1b) && t.h1b > 0 && isNum(t.h1s) && t.h1s === 0) return 'fake-data: h1 sells 0';
  if (isNum(t.liq) && t.liq > 0 && isNum(t.vol24) && t.vol24 >= 0 && t.liq > t.vol24 * 20) return 'fake-data: liquidity > 20x 24h volume';
  if (isNum(t.liq) && t.liq > 0 && isNum(t.mcap) && t.mcap > 0 && t.liq > t.mcap) return 'fake-data: liquidity > mcap';
  return '';
}

export function noteRugDrop(book, mint, px, h1) {
  if (!mint) return false;
  book.blacklist = book.blacklist || {};
  book.rugPx = book.rugPx || {};
  if (isNum(h1) && h1 <= -80) {
    book.blacklist[mint] = { at: Date.now(), why: 'price -80% within 1h' };
    return true;
  }
  if (!(px > 0) || book.blacklist[mint]) return false;
  const now = Date.now();
  let rows = (book.rugPx[mint] || []).filter(x => x && now - x.t <= 3600e3 && x.p > 0);
  const last = rows[rows.length - 1];
  if (!last || now - last.t >= 5000) rows.push({ t: now, p: px });
  book.rugPx[mint] = rows.slice(-80);
  const prior = rows.filter(x => now - x.t >= 15000);
  if (!prior.length) return false;
  const hi = Math.max(...prior.map(x => x.p));
  if (hi > 0 && px <= hi * 0.2) {
    book.blacklist[mint] = { at: now, why: 'price -80% within 1h' };
    return true;
  }
  return false;
}

export function quoteImpact(quote) {
  if (!quote || !quote.outAmount) return { ok: false, reason: 'fake-data: jupiter quote failed', pct: null };
  if (quote.priceImpactPct == null || quote.priceImpactPct === '' || !Number.isFinite(+quote.priceImpactPct)) {
    return { ok: false, reason: 'fake-data: impact cannot be computed', pct: null };
  }
  return { ok: true, reason: '', pct: +quote.priceImpactPct * 100 };
}

export function scalpLedgerOf(book) {
  const raw = book.ledgers?.scalp;
  const led = { startUsd: SCALP.START_USD, balanceUsd: SCALP.START_USD, realizedUsd: 0, trades: [] };
  if (raw && typeof raw === 'object') {
    if (raw.startUsd > 0) led.startUsd = raw.startUsd;
    if (Number.isFinite(+raw.balanceUsd)) led.balanceUsd = +raw.balanceUsd;
    if (Number.isFinite(+raw.realizedUsd)) led.realizedUsd = +raw.realizedUsd;
    if (Array.isArray(raw.trades)) led.trades = raw.trades.slice(-200);
  }
  return led;
}

export function scalpSizeUsd(book, positions, livePx) {
  const free = scalpLedgerOf(book).balanceUsd;
  const open = (positions || []).filter(p => p.open && p.mode === 'scalp');
  if (open.length >= SCALP.MAX_OPEN) return { usd: 0, label: 'max 2 open' };
  if (!(free >= SCALP.MIN_FREE)) return { usd: 0, label: 'free balance under $5' };
  if (open.length === 1) {
    const p = open[0];
    const lp = livePx(p.mint);
    if (!(isNum(lp) && p.avgUsd > 0 && lp + 1e-12 >= p.avgUsd)) return { usd: 0, label: 'first scalp under breakeven' };
    const usd = free - 0.25;
    if (usd < SCALP.MIN_FREE) return { usd: 0, label: 'remainder under $5' };
    return { usd, label: 'remainder $' + usd.toFixed(2) };
  }
  const half = free * 0.5;
  if (half < SCALP.MIN_FREE) return { usd: 0, label: '50% under $5' };
  return { usd: half, label: '50% · $' + half.toFixed(2) + ' of $' + free.toFixed(2) };
}

export function scalpTodayPnl(book) {
  const day = tehranDayKey();
  return (scalpLedgerOf(book).trades || []).filter(t => t.side === 'sell' && tehranDayKey(t.ts) === day).reduce((s, t) => s + (isNum(t.pnlUsd) ? t.pnlUsd : 0), 0);
}

export function pushSolSample(samples, px, now = Date.now()) {
  const n = +px;
  if (!(n > 0) || !Array.isArray(samples)) return samples;
  const last = samples[samples.length - 1];
  if (last && now - last.t < 20000) return samples;
  samples.push({ t: now, px: n });
  const cut = now - 25 * 60e3;
  while (samples.length && samples[0].t < cut) samples.shift();
  if (samples.length > 80) samples.splice(0, samples.length - 80);
  return samples;
}

export function solRingChange(samples, now = Date.now()) {
  const rows = (samples || []).filter(s => s && s.px > 0 && s.t > 0);
  if (rows.length < 2) return null;
  const latest = rows[rows.length - 1];
  if (now - latest.t > 3 * 60e3) return null;
  const target = now - 15 * 60e3;
  let best = null;
  for (const s of rows) {
    const age = now - s.t;
    if (age < 12 * 60e3 || age > 20 * 60e3) continue;
    if (!best || Math.abs(s.t - target) < Math.abs(best.t - target)) best = s;
  }
  if (!best || !(best.px > 0)) return null;
  return (latest.px / best.px - 1) * 100;
}

export function resolveSolM15({ candles, samples, m5, h1, now = Date.now() } = {}) {
  const cs = Array.isArray(candles) ? candles : [];
  const prev = cs.length >= 2 ? cs[cs.length - 2] : null;
  const last = cs.length >= 2 ? cs[cs.length - 1] : null;
  if (prev && last && prev.c > 0 && last.c > 0) return { m15: (last.c / prev.c - 1) * 100, m15Source: 'ohlcv' };
  const ring = solRingChange(samples, now);
  if (ring != null) return { m15: ring, m15Source: 'ring' };
  if (isNum(m5) || isNum(h1)) return { m15: null, m15Source: 'proxy' };
  return { m15: null, m15Source: '' };
}

export function scalpSolBlockReason(sol) {
  const h1 = isNum(sol?.h1) ? +sol.h1 : null;
  const m5 = isNum(sol?.m5) ? +sol.m5 : null;
  const m15 = isNum(sol?.m15) ? +sol.m15 : null;
  const source = sol?.m15Source || '';
  if (h1 != null && h1 < SCALP.SOL_1H_MIN) return 'SOL 1h ' + h1.toFixed(1) + '%';
  if (source === 'ohlcv' || source === 'ring') {
    if (m15 != null && m15 < SCALP.SOL_15M_MIN) return 'SOL 15m ' + m15.toFixed(1) + '%';
    return '';
  }
  if (source === 'proxy') {
    if (m5 != null && m5 < SCALP.SOL_15M_MIN) return 'SOL m5 ' + m5.toFixed(1) + '%';
    if (h1 != null && h1 < SCALP.SOL_1H_MIN) return 'SOL 1h ' + h1.toFixed(1) + '%';
    return '';
  }
  return '';
}

export function scalpDayBlock(book) {
  const log = book.scalpLog || {};
  const day = tehranDayKey();
  if (log.dayKey !== day) return '';
  if (log.haltDay === day) return 'scalp stopped for the day';
  if ((+log.pausesToday || 0) >= SCALP.MAX_PAUSES) return 'two pauses today';
  if (log.pauseUntil > Date.now()) return 'paused 30m after 3 losses';
  return '';
}

function scalpStrongBreak(m1) {
  const src = (m1 || []).filter(c => c && c.c > 0 && c.l > 0);
  const win = src.slice(-5);
  let best = null, score = -1;
  for (let i = 0; i < win.length; i++) {
    const c = win[i];
    const idx = src.length - win.length + i;
    const before = src.slice(Math.max(0, idx - 5), idx);
    if (!before.length) continue;
    const resist = Math.max(...before.map(x => x.h));
    if (!(c.c > resist)) continue;
    const body = c.o > 0 ? Math.abs(c.c - c.o) : Math.abs(c.c - c.l);
    const vol = c.v > 0 ? c.v : 1;
    if (body * vol > score) { score = body * vol; best = c; }
  }
  return best;
}

export function scalpContext(bars, px, meta) {
  const m1 = (bars?.m1 || []).filter(c => c && c.c > 0);
  const m15 = (bars?.m15 || []).filter(c => c && c.c > 0);
  const h1 = (bars?.h1 || []).filter(c => c && c.c > 0);
  const last = m1[m1.length - 1];
  const prior5 = m1.slice(-6, -1);
  const broke = !!(last && prior5.length === 5 && last.c > Math.max(...prior5.map(c => c.h)));
  const prior20 = m1.slice(-21, -1);
  const avg = prior20.length ? prior20.reduce((s, c) => s + (c.v || 0), 0) / prior20.length : 0;
  const volX = avg > 0 && last ? (last.v || 0) / avg : 0;
  const body = last && last.o > 0 ? Math.abs(last.c - last.o) / last.o : 1;
  const closes = m1.map(c => c.c);
  const ema20 = closes.length >= 20 ? emaLast(closes, 20) : null;
  const base = m1.length >= 4 ? m1[m1.length - 4].c : 0;
  const last3 = base > 0 && last ? last.c / base - 1 : 1;
  const c15 = m15.map(c => c.c);
  const ema15 = c15.length >= 20 ? emaLast(c15, 20) : null;
  const ema15Prev = c15.length >= 21 ? emaLast(c15.slice(0, -1), 20) : null;
  let lowerLow = false;
  const bars4 = h1.slice(-4);
  if (bars4.length >= 3) {
    const start = Math.max(1, bars4.length - 3);
    for (let i = start; i < bars4.length; i++) if (bars4[i].l < bars4[i - 1].l) lowerLow = true;
  }
  const strong = scalpStrongBreak(m1);
  const breakLow = strong && strong.l > 0 ? strong.l * (1 - SCALP.STOP_BUF) : (last && last.l > 0 ? last.l * (1 - SCALP.STOP_BUF) : null);
  const level = +meta?.resist || 0;
  let room = '';
  if (level > px && px > 0 && level / px - 1 <= SCALP.ROOM) {
    if (!(last && last.o <= level && last.c > level)) room = 'resistance within +5%';
  }
  return { ...meta, px, broke, volX, body, ema20, last3, ema15, ema15Prev, lowerLow, breakLow, room, m1 };
}

export function scalpEntryFail(ctx) {
  const R = SCALP;
  if (!(ctx.ageH >= R.AGE_MIN_H)) return 'pair age < 2h';
  if (ctx.curve) return 'bonding curve';
  if (!ctx.dexOk) return 'not a graduated pool';
  if (!(ctx.liq >= R.LIQ_MIN)) return 'liquidity < $50k';
  if (!(ctx.vol24 >= R.VOL24_MIN)) return '24h volume < $100k';
  if (ctx.flag) return ctx.flag;
  if (isNum(ctx.top10) && ctx.top10 > R.TOP10_MAX) return 'top10 ' + ctx.top10.toFixed(0) + '%';
  if (isNum(ctx.insiders) && ctx.insiders > R.INSIDER_MAX) return 'insiders ' + ctx.insiders.toFixed(0) + '%';
  if (!(ctx.px > ctx.ema15)) return 'price below 15m EMA20';
  if (!(ctx.ema15 > ctx.ema15Prev)) return '15m EMA20 not rising';
  if (ctx.lowerLow) return '1h lower low';
  if (ctx.room) return ctx.room;
  if (!ctx.broke) return 'no 1m breakout';
  if (!(ctx.volX >= R.VOL_MULT)) return 'breakout volume under 2x';
  if (!(ctx.body <= R.BODY_MAX)) return 'breakout body > 4%';
  if (!(ctx.px > ctx.ema20)) return 'price below 1m EMA20';
  if (!(ctx.px <= ctx.ema20 * (1 + R.EMA20_MAX_ABOVE))) return 'more than 3% above 1m EMA20';
  if (!(ctx.last3 <= R.LAST3_MAX)) return 'last 3 candles > +8%';
  if (!(ctx.m5 >= R.M5_MIN && ctx.m5 <= R.M5_MAX)) return 'm5 change out of +1% to +10%';
  if (isNum(ctx.h1) && ctx.h1 > R.H1_MAX) return 'h1 > +60%';
  if (!(ctx.buys >= ctx.sells * R.FLOW)) return 'm5 buys < 1.2x sells';
  if (!(ctx.buys >= R.BUYS_MIN)) return 'm5 buy txns < 15';
  if (isNum(ctx.impact) && ctx.impact > R.IMPACT_MAX) return 'price impact ' + ctx.impact.toFixed(2) + '%';
  if (isNum(ctx.drift) && Math.abs(ctx.drift) > R.QUOTE_DRIFT) return 'quote differs from last price > 1%';
  return '';
}

export function scalpStopLevel(entry, breakLow, lp, high, runner) {
  const hard = entry * (1 - SCALP.STOP_PCT);
  let stop = hard;
  if (isNum(breakLow) && breakLow > 0 && breakLow < entry) stop = Math.max(breakLow, hard);
  const peak = Math.max(entry, isNum(high) ? high : 0, isNum(lp) ? lp : 0);
  const up = peak / entry - 1;
  if (up >= SCALP.BE_ARM) stop = Math.max(stop, entry * (1 + SCALP.BE_STOP));
  const ran = !!runner || up >= SCALP.RUNNER_AT;
  if (ran) {
    const trailPct = up > SCALP.TRAIL_TIGHT_AT ? SCALP.TRAIL_TIGHT : SCALP.TRAIL;
    stop = Math.max(stop, entry * (1 + SCALP.FLOOR), peak * (1 - trailPct));
  }
  return { stop, runner: ran, peak };
}

export function scalpFadeReason(candles, m5b, m5s) {
  if (isNum(m5b) && isNum(m5s) && m5s >= m5b && (m5b + m5s) > 0) return 'm5 sells >= buys';
  const cs = candles || [];
  if (cs.length >= 2) {
    const prev = cs[cs.length - 2], last = cs[cs.length - 1];
    if (last.h < prev.h) return '1m lower high';
    if ((last.v || 0) < (prev.v || 0)) return '1m volume dropping';
  }
  return '';
}

export function scalpExitReason(p, lp, candles, flow) {
  const entry = p.avgUsd;
  if (!(entry > 0) || !(lp > 0)) return '';
  const prot = p.prot || {};
  if (isNum(prot.entryLiq) && prot.entryLiq > 0 && isNum(flow?.liq) && flow.liq <= prot.entryLiq * 0.5) return 'liquidity pull';
  if (p.plan?.kind === 'breakout1h' || p.plan?.kind === 'trendhold1h') {
    const stop = +p.plan.stop;
    if (stop > 0 && lp <= stop) return 'breakout stop';
    return '';
  }
  const high = Math.max(prot.high || 0, entry, lp);
  const runner = !!prot.runner || high >= entry * (1 + SCALP.RUNNER_AT);
  const ageMin = (Date.now() - (p.firstTs || Date.now())) / 60000;
  if (!runner && ageMin >= SCALP.TIME_FLAT_MIN && high < entry * (1 + SCALP.TIME_FLAT_NEED)) return 'no +1.5% in 4m';
  if (!runner && ageMin >= SCALP.TIME_HARD_MIN) return 'time stop 10m';
  if (runner) {
    const closes = (candles || []).map(c => c.c).filter(n => n > 0);
    const ema9 = closes.length >= 9 ? emaLast(closes, 9) : null;
    const last = candles && candles[candles.length - 1];
    if (isNum(ema9) && last && last.c < ema9) return '1m close below EMA9';
    const fade = scalpFadeReason(candles, flow?.m5b, flow?.m5s);
    if (fade) return fade;
  }
  const lvl = scalpStopLevel(entry, p.plan?.breakLow, lp, high, runner);
  const arm = p.stopArm || { ticks: 0, since: 0 };
  if (lp <= lvl.stop) {
    arm.ticks = (arm.ticks || 0) + 1;
    if (!arm.since) arm.since = Date.now();
    p.stopArm = arm;
    if (arm.ticks >= SCALP.STOP_TICKS || Date.now() - arm.since >= SCALP.STOP_MS) return runner ? 'trail stop' : (lvl.stop >= entry ? 'stop to +0.5%' : 'stop -3%');
  } else p.stopArm = { ticks: 0, since: 0 };
  p.prot = { ...prot, high, runner, entryLiq: prot.entryLiq };
  return '';
}

export function scalpDexOk(dex) {
  const d = String(dex || '').toLowerCase();
  if (!d) return false;
  if (/pumpfun|pump\.fun|moonshot|launchlab|bonding/.test(d)) return false;
  if (d.includes('pump') && !d.includes('pumpswap')) return false;
  return /pumpswap|raydium|meteora/.test(d);
}

export function mlGeometry(candles) {
  const cs = (candles || []).filter(c => c && c.h > 0 && c.l > 0 && c.c > 0).slice(-48);
  if (cs.length < 15) return null;
  const { highs } = swingPoints(cs, 2);
  if (highs.length < 2) return null;
  let use = highs.slice(-2);
  const tail = highs.slice(-3);
  if (tail.length === 3 && tail[1].price < tail[0].price && tail[2].price < tail[1].price) use = tail;
  else if (!(highs.at(-1).price < highs.at(-2).price)) return null;
  const a = use[0], b = use[use.length - 1];
  if (!(b.price < a.price)) return null;
  const line = lineAt(a, b, cs.length - 1);
  let best = null;
  for (const h of highs) {
    const cluster = highs.filter(x => Math.abs(x.price - h.price) / h.price <= 0.015);
    if (cluster.length < 2) continue;
    const lo = Math.min(...cluster.map(x => x.price));
    const hi = Math.max(...cluster.map(x => x.price));
    const mid = (lo + hi) / 2;
    if (!best || cluster.length > best.n || (cluster.length === best.n && Math.abs(mid - line) < Math.abs(best.mid - line))) best = { lo, hi, mid, n: cluster.length };
  }
  if (!best) {
    const h = highs.at(-1);
    best = { lo: h.price * 0.992, hi: h.price * 1.008, mid: h.price, n: 1 };
  }
  return { line, zoneLo: best.lo, zoneHi: best.hi, a, b };
}

export function mlStrongCandle(candles, lineOf) {
  const cs = (candles || []).filter(c => c && c.c > 0 && c.l > 0);
  let best = null, score = -1;
  for (let i = 2; i < cs.length; i++) {
    const lv = lineOf(i);
    if (!(lv > 0) || !(cs[i].c > lv)) continue;
    const body = cs[i].o > 0 ? Math.abs(cs[i].c - cs[i].o) : Math.abs(cs[i].c - cs[i].l);
    const vol = cs[i].v > 0 ? cs[i].v : 1;
    if (body * vol > score) { score = body * vol; best = cs[i]; }
  }
  return best;
}

export function mlStop(entry, candleLow) {
  if (!(entry > 0)) return null;
  const raw = (candleLow > 0 ? candleLow : entry) * (1 - 0.015);
  const floor = entry * (1 - 0.15);
  const stop = Math.max(raw, floor);
  return stop < entry ? stop : floor;
}

function h1Parts(candles, now) {
  const cs = (candles || []).filter(c => c && c.h > 0 && c.l > 0 && c.c > 0 && c.o > 0);
  const stamped = cs.filter(c => c.t > 0).sort((a, b) => a.t - b.t);
  if (stamped.length) {
    return {
      closed: stamped.filter(c => c.t + 3600e3 <= now),
      forming: stamped.filter(c => c.t <= now && c.t + 3600e3 > now).at(-1) || null
    };
  }
  if (cs.length < 2) return { closed: [], forming: cs[0] || null };
  return { closed: cs.slice(0, -1), forming: cs[cs.length - 1] };
}
function h1VolOk(bar, prior, spike) {
  const vol = (prior || []).slice(-20);
  if (vol.length < 20) return false;
  const avg = vol.reduce((s, c) => s + (c.v > 0 ? c.v : 0), 0) / 20;
  if (avg > 0 && bar.v >= avg) return true;
  if (spike && +spike.mult >= 2) return true;
  if (spike && +spike.avg > 0 && +spike.v >= +spike.avg * 2) return true;
  return false;
}
function h1TrendPts(prior) {
  if (!prior || prior.length < 15) return null;
  const { highs } = swingPoints(prior, 2);
  if (highs.length < 2) return null;
  let use = highs.slice(-2);
  const tail = highs.slice(-3);
  if (tail.length === 3 && tail[1].price < tail[0].price && tail[2].price < tail[1].price) use = tail;
  else if (!(highs.at(-1).price < highs.at(-2).price)) return null;
  const a = use[0], b = use[use.length - 1];
  if (!(b.price < a.price)) return null;
  return { a, b };
}
function h1TrendAt(prior, index) {
  const fit = h1TrendPts(prior);
  if (!fit) return 0;
  const lv = lineAt(fit.a, fit.b, index);
  return lv > 0 ? lv : 0;
}
function h1BodyVolBreak(bar, line, avg) {
  const range = bar.h - bar.l;
  const body = Math.abs(bar.c - bar.o);
  return range > 0 && body + 1e-12 >= range * 0.5 && avg > 0 && bar.v >= avg * 1.5 && bar.c > line;
}
function h1ResistZone(prior, bar) {
  const src = (prior || []).slice(-48);
  if (src.length < 2 || !(bar?.c > 0) || !(bar.o > 0)) return null;
  const pre = Math.min(bar.o > 0 ? bar.o : Infinity, src[src.length - 1].c || Infinity);
  if (!(pre > 0) || pre === Infinity) return null;
  const touches = [];
  src.forEach((c, i) => {
    if (c.h > 0) touches.push({ i, p: c.h });
    if (c.c > 0) touches.push({ i, p: c.c });
  });
  let best = null;
  for (const anchor of touches) {
    const band = touches.filter(t => t.p + 1e-12 >= anchor.p && t.p <= anchor.p * 1.07);
    if (band.length < 2) continue;
    const lo = Math.min(...band.map(t => t.p));
    const hi = Math.max(...band.map(t => t.p));
    if (!(hi > lo) || hi / lo - 1 > 0.07) continue;
    const ids = new Set(band.map(t => t.i));
    if (ids.size < 2) continue;
    if (!(lo > pre)) continue;
    const first = Math.min(...ids);
    const last = Math.max(...ids);
    if (!src.slice(first + 1).some(c => c.l > 0 && c.l <= lo * 0.97)) continue;
    if (!src.slice(last + 1).some(c => c.h > 0 && c.h < lo)) continue;
    if (!best || last > best.last || (last === best.last && hi > best.hi)) best = { lo, hi, last, n: ids.size };
  }
  return best;
}

/** Forming 1h candle vs the descending trendline and the last resistance box. Buys on the live cross, not the close. */
export function h1BreakSignal(candles, now = Date.now(), livePx = null, spike = null) {
  const { closed, forming } = h1Parts(candles, now);
  const wait = { buy: false, fa: '', state: 'wait', entry: null, stop: null, target: null, zoneLo: null, zoneHi: null, line: null, low: null, key: '', reason: 'waiting' };
  if (!forming || closed.length < 21) return { ...wait, fa: closed.length ? 'منتظر شکست' : '' };
  const line = h1TrendAt(closed, closed.length);
  const zone = h1ResistZone(closed, forming);
  const zoneLo = zone ? zone.lo : (line > 0 ? line : null);
  const zoneHi = zone ? zone.hi : (line > 0 ? line * 1.03 : null);
  if (!(line > 0) || !(zoneHi > 0)) return { ...wait, fa: 'منتظر شکست', zoneLo, zoneHi, line, reason: 'no trendline' };
  const px = isNum(livePx) && livePx > 0 ? livePx : forming.c;
  const stop = forming.l > 0 ? forming.l * (1 - 0.015) : null;
  const crossed = px > line && px > zoneHi;
  const key = Math.round(line * 1e8) + ':' + Math.round(zoneHi * 1e8);
  if (!crossed || !h1VolOk(forming, closed, spike) || !(stop > 0) || !(stop < px)) {
    return { ...wait, fa: 'منتظر شکست', zoneLo, zoneHi, line, key, reason: crossed ? 'no volume' : 'waiting for the cross' };
  }
  return {
    buy: true, fa: 'شکست شد · خرید', state: 'buy', entry: px, stop, target: px * 1.3,
    zoneLo, zoneHi, line, low: forming.l, key,     reason: '1h breakout'
  };
}

/** Strong closed 1h trendline break, then two closed holds above the line. Buys the second hold's close. */
export function h1TrendHold(candles, now = Date.now()) {
  const { closed } = h1Parts(candles, now);
  const wait = { buy: false, kind: 'trendhold1h', entry: null, stop: null, target: null, line: null, low: null, key: '', reason: 'waiting' };
  if (closed.length < 24) return wait;
  const i = closed.length - 3;
  const prior = closed.slice(0, i);
  const fit = h1TrendPts(prior);
  if (!fit) return { ...wait, reason: 'no trendline' };
  const at = (idx) => lineAt(fit.a, fit.b, idx);
  const line = at(i);
  const br = closed[i], hold1 = closed[i + 1], hold2 = closed[i + 2];
  const vol = prior.slice(-20);
  const avg = vol.reduce((s, c) => s + (c.v > 0 ? c.v : 0), 0) / 20;
  if (vol.length < 20 || !(line > 0) || !h1BodyVolBreak(br, line, avg)) return { ...wait, line, reason: 'no strong break' };
  const stop = br.l > 0 ? br.l * (1 - 0.015) : null;
  const key = 'hold:' + Math.round(line * 1e8) + ':' + (br.t || i);
  if (!(hold1.c > at(i + 1)) || !(hold2.c > at(i + 2))) return { ...wait, line, stop, key, reason: 'closed back below the trendline' };
  if (!(stop > 0) || !(stop < hold2.c)) return { ...wait, line, key, stop, reason: 'stop' };
  return { buy: true, kind: 'trendhold1h', entry: hold2.c, stop, target: hold2.c * 1.3, line, low: br.l, key, reason: 'trend break + hold' };
}

function ceilingZone(prior) {
  const src = (prior || []).slice(-48);
  if (src.length < 10) return null;
  const { highs } = swingPoints(src, 2);
  if (highs.length < 2) return null;
  let best = null;
  for (let i = 0; i < highs.length; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      const lo = Math.min(highs[i].price, highs[j].price);
      const hi = Math.max(highs[i].price, highs[j].price);
      if (!(hi > 0) || Math.log(hi) - Math.log(lo) > Math.log(1.07)) continue;
      const last = Math.max(highs[i].i, highs[j].i);
      const first = Math.min(highs[i].i, highs[j].i);
      const after = src.slice(last + 1);
      if (!after.length) continue;
      const preClose = after[after.length - 1].c;
      if (!(lo > preClose)) continue;
      if (!after.some(c => c.h > 0 && c.h < lo)) continue;
      if (!src.slice(first + 1, last + 2).some(c => c.l > 0 && c.l <= lo * 0.97)) continue;
      if (!best || last > best.last) best = { lo, hi, last, first };
    }
  }
  return best;
}

function closedM15(m15, now) {
  return (m15 || []).filter(c => c && c.c > 0 && c.t > 0 && c.t + 15 * 60e3 <= now).sort((a, b) => a.t - b.t);
}

/** 1h ceiling break, then the 15m close that finishes above the box. */
export function ceilingBreakSignal(h1, m15, now = Date.now()) {
  const empty = { buy: false, kind: 'ceilingbreak', entry: null, stop: null, target: null, ceilingLo: null, ceilingHi: null, base: null, key: '', reason: 'waiting' };
  const { closed, forming } = h1Parts(h1, now);
  const bars = forming ? closed.concat([forming]) : closed.slice();
  if (bars.length < 16) return empty;
  let found = null;
  for (let i = 12; i < bars.length; i++) {
    const prior = bars.slice(0, i);
    const zone = ceilingZone(prior);
    if (!zone) continue;
    const bar = bars[i];
    if (!(bar.c > zone.hi || bar.h > zone.hi)) continue;
    found = { zone, bar, prior };
  }
  if (!found) return empty;
  const after = found.prior.slice(found.zone.last + 1);
  const lows = (after.length ? after : found.prior.slice(-4)).map(c => c.l).filter(x => x > 0);
  const base = lows.length ? Math.min(...lows) : null;
  const stop = base > 0 ? base * 0.99 : null;
  const view = { ...empty, ceilingLo: found.zone.lo, ceilingHi: found.zone.hi, base, stop, reason: 'waiting 15m close' };
  const breakT = found.bar.t || 0;
  const hit = closedM15(m15, now).find(c => c.c > found.zone.hi && (!breakT || c.t + 15 * 60e3 > breakT));
  if (!hit) return view;
  if (!(stop > 0) || !(stop < hit.c)) return { ...view, reason: 'stop' };
  return {
    buy: true, kind: 'ceilingbreak', entry: hit.c, stop, target: hit.c * 1.3,
    ceilingLo: found.zone.lo, ceilingHi: found.zone.hi, base,
    key: 'ceil:' + Math.round(found.zone.hi * 1e8) + ':' + hit.t, reason: 'ceilingbreak'
  };
}

export function lhStructure(closed) {
  const { highs, lows } = swingPoints(closed || [], 2);
  if (highs.length < 2) return null;
  const seq = [highs[highs.length - 1]];
  for (let i = highs.length - 2; i >= 0; i--) {
    if (highs[i].price > seq[0].price) seq.unshift(highs[i]);
    else break;
  }
  if (seq.length < 2 || !(seq[seq.length - 1].price < seq[0].price)) return null;
  const a = seq[0];
  const b = seq[seq.length - 1];
  let hl = null;
  for (let i = lows.length - 1; i >= 1; i--) {
    if (lows[i].i > b.i) continue;
    if (lows[i].price > lows[i - 1].price) { hl = lows[i]; break; }
  }
  return { a, b, lastLH: b.price, lhIndex: b.i, hl };
}

/** Downtrend line plus the last lower high. Score bonus when the LH breaks; buy on the 15m close. */
export function lhBreakSignal(h1, m15, now = Date.now(), livePx = null) {
  const empty = { buy: false, kind: 'lhbreak', broken: false, entry: null, stop: null, target: null, lastLH: null, line: null, hl: null, key: '', reason: 'waiting' };
  const { closed, forming } = h1Parts(h1, now);
  if (closed.length < 20) return empty;
  const st = lhStructure(closed);
  if (!st) return empty;
  const idx = forming ? closed.length : closed.length - 1;
  const line = lineAt(st.a, st.b, idx);
  const px = isNum(livePx) && livePx > 0 ? livePx : (forming?.c || closed[closed.length - 1].c);
  const broken = px > st.lastLH;
  const aboveLine = line > 0 && px > line;
  const stop = st.hl && st.hl.price > 0 ? st.hl.price * 0.99 : null;
  const view = { ...empty, broken, lastLH: st.lastLH, line, hl: st.hl ? st.hl.price : null, stop, reason: broken ? 'waiting 15m close' : 'watching LH' };
  const lhT = closed[st.lhIndex]?.t || 0;
  const hit = closedM15(m15, now).filter(c => c.c > st.lastLH && (!lhT || c.t >= lhT)).at(-1);
  if (!(broken && aboveLine && hit && stop > 0 && stop < hit.c)) return view;
  return {
    buy: true, kind: 'lhbreak', broken: true, entry: hit.c, stop, target: hit.c * 1.3,
    lastLH: st.lastLH, line, hl: st.hl.price,
    key: 'lh:' + Math.round(st.lastLH * 1e8) + ':' + hit.t, reason: 'lhbreak'
  };
}

function tfParts(candles, now, span) {
  const cs = (candles || []).filter(c => c && c.h > 0 && c.l > 0 && c.c > 0 && c.o > 0);
  const stamped = cs.filter(c => c.t > 0).sort((a, b) => a.t - b.t);
  if (stamped.length) {
    return {
      closed: stamped.filter(c => c.t + span <= now),
      forming: stamped.filter(c => c.t <= now && c.t + span > now).at(-1) || null
    };
  }
  if (cs.length < 2) return { closed: [], forming: cs[0] || null };
  return { closed: cs.slice(0, -1), forming: cs[cs.length - 1] };
}

/** 4h or 1d downtrend break, then a 1h retest that closes back above the broken level. */
export function htfRetestSignal(htf, h1, now = Date.now(), span = 4 * 3600e3) {
  const empty = { buy: false, kind: 'htfretest', phase: '', entry: null, stop: null, target: null, line: null, lastLH: null, level: null, hl: null, key: '', reason: 'waiting', tf: span >= 20 * 3600e3 ? '1d' : '4h' };
  const { closed } = tfParts(htf, now, span);
  if (closed.length < 16) return empty;
  const latest = lhStructure(closed);
  let watch = null;
  if (latest && latest.b.i - latest.a.i >= 8) {
    watch = { ...empty, phase: 'watch', line: lineAt(latest.a, latest.b, closed.length - 1), lastLH: latest.lastLH, reason: 'HTF downtrend, unbroken' };
  }
  let chosen = null;
  for (let i = 12; i < closed.length; i++) {
    const prior = closed.slice(0, i);
    const st = lhStructure(prior);
    if (!st || st.b.i - st.a.i < 8) continue;
    const line = lineAt(st.a, st.b, i);
    const bar = closed[i];
    if (!(line > 0) || !(bar.c > line) || !(bar.c > st.lastLH)) continue;
    const vol = prior.slice(-20);
    if (vol.length < 20) continue;
    const avg = vol.reduce((s, c) => s + (c.v > 0 ? c.v : 0), 0) / 20;
    if (!(avg > 0) || !(bar.v > avg)) continue;
    const level = Math.max(line, st.lastLH);
    if (closed.slice(i + 1).some(c => c.c > 0 && c.c < level)) continue;
    chosen = { line, level, lastLH: st.lastLH, breakClose: (bar.t || 0) + span, bar };
  }
  if (!chosen) return watch || empty;
  const deadline = chosen.breakClose + 72 * 3600e3;
  const { closed: h1c } = tfParts(h1, now, 3600e3);
  const after = h1c.filter(c => (c.t || 0) + 3600e3 > chosen.breakClose);
  let touched = false;
  let hold = null;
  for (const c of after) {
    if (c.l > 0 && c.l <= chosen.level * 1.03) touched = true;
    if (touched && c.c > chosen.level) {
      if ((c.t || 0) + 3600e3 <= deadline) hold = c;
      break;
    }
  }
  const priorH1 = h1c.filter(c => !hold || c.t < hold.t);
  const { lows } = swingPoints(priorH1, 2);
  const recent = lows.filter(l => (priorH1[l.i]?.t || 0) >= chosen.breakClose - 3600e3);
  let base = null;
  for (let i = recent.length - 1; i >= 1; i--) {
    if (recent[i].price > recent[i - 1].price) { base = recent[i].price; break; }
  }
  if (!(base > 0) && recent.length) base = recent[recent.length - 1].price;
  if (!(base > 0)) {
    const pull = priorH1.filter(c => (c.t || 0) >= chosen.breakClose - 3600e3).map(c => c.l).filter(x => x > 0);
    if (pull.length) base = Math.min(...pull);
  }
  const stop = base > 0 ? base * 0.99 : null;
  const expired = !hold && now > deadline;
  const view = {
    ...empty, phase: expired ? 'expired' : 'retest', line: chosen.line, lastLH: chosen.lastLH, level: chosen.level, hl: base, stop,
    key: 'htf:' + Math.round(chosen.level * 1e8) + ':' + (chosen.bar.t || 0),
    reason: expired ? 'HTF retest expired' : 'waiting for the 1h hold'
  };
  if (!hold || !(stop > 0) || !(stop < hold.c)) return view;
  return { ...view, buy: true, phase: 'buy', entry: hold.c, stop, target: hold.c * 1.3, reason: 'htfretest' };
}

export function listWalletSize(balance, reserve, openCount) {
  const n = +openCount || 0;
  const tradable = (+balance || 0) - (+reserve || 0);
  if (n >= 2) return { sol: 0, label: 'max 2 open' };
  if (!(tradable >= 0.002)) return { sol: 0, label: 'balance under reserve' };
  if (n === 1) return { sol: +tradable.toFixed(6), label: 'remainder ' + tradable.toFixed(3) + ' SOL · max 2' };
  const half = tradable * 0.5;
  return { sol: +half.toFixed(6), label: '50% · ' + half.toFixed(3) + ' SOL of ' + tradable.toFixed(3) + ' · max 2' };
}

export function planFresh(p, now = Date.now()) {
  const ts = +p?.ts || +p?.updatedAt || 0;
  const stamp = ts > 0 && ts < 1e12 ? ts * 1000 : ts;
  if (!(stamp > 0) || now - stamp > 2 * 3600e3) return false;
  const exp = +p?.expires || 0;
  const expiry = exp > 0 && exp < 1e12 ? exp * 1000 : exp;
  if (expiry > 0 && now > expiry) return false;
  return true;
}

export function planTriggerHit(p, px) {
  if (!(px > 0)) return false;
  const mode = String(p?.entry_mode || '').toLowerCase();
  const cond = String(p?.trigger_condition || '').toLowerCase();
  const trig = +p?.trigger_price || 0;
  if (mode === 'immediate' || mode === 'now' || /immediate|market/.test(cond)) return true;
  if (!(trig > 0)) return false;
  const pad = 0.015;
  if (mode === 'retest' || /retest|pullback/.test(cond)) return px <= trig * (1 + pad) && px >= trig * (1 - pad);
  if (mode === 'below' || /below|under|dip/.test(cond)) return px <= trig * (1 + pad);
  return px >= trig * (1 - pad);
}

export function planUsable(p) {
  return !!(p && planFresh(p) && p.status === 'ready' && +p.confidence >= 60);
}

export function degenPotLimits(pot) {
  const tighten = (cap, v) => {
    const n = +v;
    if (!Number.isFinite(n) || n <= 0) return cap;
    return Math.min(cap, n);
  };
  const budgetUsd = tighten(25, pot?.budget_usd);
  let tradeUsd = tighten(12.5, pot?.per_trade_usd);
  if (tradeUsd > budgetUsd) tradeUsd = budgetUsd;
  const maxOpen = Math.max(1, Math.round(tighten(2, pot?.max_open)));
  return { budgetUsd, tradeUsd, maxOpen };
}
export function degenLossPct(v) {
  const n = Math.abs(+v);
  if (!(isNum(n) && n > 0)) return 25;
  return Math.min(25, Math.max(12, n));
}

export function degenExitDecision(p, lp, flow) {
  if (!(p?.avgUsd > 0) || !(lp > 0)) return null;
  const entry = p.avgUsd;
  const prot = p.prot || {};
  const high = Math.max(prot.high || 0, entry, lp);
  const entryLiq = prot.entryLiq;
  if (high > 0 && lp <= high * 0.65) return { pct: 100, tag: 'rug', reason: 'rug exit' };
  if (isNum(entryLiq) && entryLiq > 0 && isNum(flow?.liq) && flow.liq <= entryLiq * 0.5) return { pct: 100, tag: 'rug', reason: 'liquidity pull' };
  const gain = lp / entry - 1;
  const loss = degenLossPct(p.plan?.stopPct);
  let stop = entry * (1 - loss / 100);
  let rule = 'degen -' + loss + '%';
  if (gain >= 0.5 || prot.be) stop = Math.max(stop, entry * 1.01), rule = stop >= entry ? 'BE@+50' : rule;
  if (gain >= 0.8 || prot.trail80) stop = Math.max(stop, high * 0.8), rule = 'trail@+80';
  const trail = isNum(+p.plan?.trail) ? Math.abs(+p.plan.trail) : 20;
  if (p.tp1Done && high > 0 && trail > 0 && trail < 100) stop = Math.max(stop, high * (1 - trail / 100)), rule = 'TP1 trail';
  p.prot = { ...prot, high, be: gain >= 0.5 || !!prot.be, trail80: gain >= 0.8 || !!prot.trail80, entryLiq: isNum(flow?.liq) && prot.entryLiq == null ? flow.liq : entryLiq };
  if (lp <= stop) return { pct: 100, tag: /trail|BE/.test(rule) ? 'trail' : 'stop', reason: rule };
  if (!p.tp1Done && gain > 0.6) {
    const pressure = isNum(flow?.m5s) && isNum(flow?.m5b) && flow.m5s > flow.m5b;
    const offHigh = high > 0 && lp <= high * 0.85;
    if (pressure || offHigh) return { pct: 50, tag: 'tp1', reason: pressure ? 'early 50% (sells>buys)' : 'early 50% (-15% from high)' };
  }
  if (!p.tp1Done && lp >= entry * 2) {
    p.tpStreak = (p.tpStreak || 0) + 1;
    if (p.tpStreak >= 2) return { pct: 50, tag: 'tp1', reason: '2x' };
  } else if (!p.tp1Done) p.tpStreak = 0;
  const ageMin = (Date.now() - (p.firstTs || Date.now())) / 60000;
  const timeStop = isNum(+p.plan?.timeStopMin) ? +p.plan.timeStopMin : 45;
  if (!p.tp1Done && ageMin >= timeStop && lp <= entry) return { pct: 100, tag: 'time', reason: 'time' };
  return null;
}

export function livePreReason(p) {
  const ageH = isNum(p.ageH) ? p.ageH : null;
  if (!(isNum(ageH) && ageH < 6)) return 'age ' + (ageH == null ? 'unknown' : ageH.toFixed(1) + 'h');
  if (!(isNum(p.liq) && p.liq >= 40000)) return 'liquidity under $40k';
  const m5b = +p.m5b || 0, h1b = +p.h1b || 0, m5v = +p.m5vol || 0, h1v = +p.h1vol || 0;
  if (!(h1b > 0) || !(h1v > 0)) return 'no h1 baseline';
  if (!((m5b * 12) / h1b > 1.15 && (m5v * 12) / h1v > 1.1 && m5b > (+p.m5s || 0))) return 'volume or buys not accelerating';
  if (isNum(p.h1) && p.h1 > 1000 && !(isNum(p.m5) && p.m5 <= 0)) return 'extended +' + Math.round(p.h1) + '% 1h';
  return '';
}

export function liveConfidence(p) {
  let s = 45;
  if (p.liq >= 80000) s += 8;
  const buyAccel = p.h1b > 0 ? (p.m5b * 12) / p.h1b : 1;
  const volAccel = p.h1vol > 0 ? (p.m5vol * 12) / p.h1vol : 1;
  if (buyAccel > 1.5) s += 12;
  if (volAccel > 1.5) s += 8;
  if (p.m5b > p.m5s * 1.3) s += 8;
  if (isNum(p.h1) && p.h1 > 0 && p.h1 < 300) s += 6;
  return Math.max(0, Math.min(95, Math.round(s)));
}

export function applyLedgerSell(led, mint, tokens, usdBack, feeUsd) {
  const lot = { tokens: 0, cost: 0 };
  for (const t of led.trades || []) {
    if (t.mint !== mint) continue;
    if (t.side === 'buy') { lot.tokens += +t.tokenAmount || 0; lot.cost += +t.usd || 0; }
    else if (lot.tokens > 0 && +t.tokenAmount > 0) {
      const frac = Math.min(1, (+t.tokenAmount) / lot.tokens);
      lot.cost *= 1 - frac;
      lot.tokens = Math.max(0, lot.tokens - +t.tokenAmount);
    }
  }
  const costOut = lot.tokens > 0 && tokens > 0 ? lot.cost * Math.min(1, tokens / lot.tokens) : 0;
  led.balanceUsd = usd6(led.balanceUsd + usdBack);
  led.realizedUsd = usd6((led.realizedUsd || 0) + usdBack - costOut);
  return { costOut, pnlUsd: usd6(usdBack - costOut), feeUsd };
}

export { tehranDayKey, usd6 };
