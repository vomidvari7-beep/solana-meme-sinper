import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CAPS } from './rules.js';
import { usd6 } from './util.js';

const EMPTY = () => ({
  v: 1,
  paused: false,
  dryRun: false,
  toggles: { scalp: false, breakout: false, plans: false, degen: false, scan: false },
  positions: [],
  fills: [],
  ledgers: {
    scalp: { startUsd: 100, balanceUsd: 100, realizedUsd: 0, trades: [] },
    degen: { startUsd: CAPS.degenStartUsd, balanceUsd: CAPS.degenStartUsd, realizedUsd: 0, trades: [] }
  },
  scalpLog: { dayKey: '', pausesToday: 0, haltDay: '', pauseUntil: 0, streak: 0, cooldowns: {}, counts: {} },
  degenCd: {},
  blacklist: {},
  rugPx: {},
  decisions: [],
  seenPlans: {},
  seenBreaks: {},
  degenTradeUsd: CAPS.degenTradeUsd
});

export function openState(path) {
  mkdirSync(dirname(path), { recursive: true });
  let data = EMPTY();
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      data = { ...EMPTY(), ...raw, toggles: { ...EMPTY().toggles, ...(raw.toggles || {}), scalp: false }, ledgers: { ...EMPTY().ledgers, ...(raw.ledgers || {}) } };
    } catch { data = EMPTY(); }
  }
  let timer = null;
  const api = {
    data,
    path,
    save() {
      const tmp = path + '.tmp';
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, path);
    },
    touch() {
      clearTimeout(timer);
      timer = setTimeout(() => { try { api.save(); } catch { /* next tick */ } }, 400);
    },
    note(mode, mint, symbol, reason) {
      data.decisions.unshift({ at: Date.now(), mode, mint: mint || '', symbol: symbol || '', reason: String(reason || '').slice(0, 180) });
      data.decisions = data.decisions.slice(0, 60);
      api.touch();
    },
    open(mode) { return data.positions.filter(p => p.open && (!mode || p.mode === mode)); },
    findOpen(mint, mode) { return data.positions.find(p => p.open && p.mint === mint && (!mode || p.mode === mode)); }
  };
  api.save();
  return api;
}

export function mainSpentToday(state, filter) {
  const day = new Date().toDateString();
  return (state.data.fills || []).filter(f => f.side === 'buy' && f.status === 'confirmed' && new Date(f.ts).toDateString() === day && (!filter || filter(f))).reduce((s, f) => s + (f.sol || 0), 0);
}

export function clampMainBuy(state, sol, balance) {
  const want = +sol || 0;
  if (!(balance > CAPS.reserveSol)) return { sol: 0, err: 'SOL balance unknown or below reserve' };
  const byPct = balance * CAPS.balancePct / 100;
  const room = Math.max(0, balance - CAPS.reserveSol);
  const sized = Math.min(want, CAPS.maxSolPerTrade, CAPS.autoMaxSol, byPct, room);
  if (sized + 1e-9 < CAPS.minBuySol) return { sol: 0, err: 'size below 0.001 SOL after caps' };
  if (state.open().filter(p => p.mode === 'plan' || p.mode === 'breakout').length >= CAPS.maxOpen && !state.data.positions.some(p => p.open && false)) {
    const mainOpen = state.open().filter(p => p.mode === 'plan' || p.mode === 'breakout');
    if (mainOpen.length >= CAPS.maxOpen) return { sol: 0, err: 'max open positions' };
  }
  return { sol: +sized.toFixed(6), err: '' };
}

export function recordBuy(state, row) {
  const pos = {
    id: 'p' + Date.now().toString(36),
    mode: row.mode,
    mint: row.mint,
    symbol: row.symbol || '',
    open: true,
    qty: row.tokenAmount || 0,
    avgUsd: row.priceUsd || 0,
    costUsd: row.usd || 0,
    costSol: row.sol || 0,
    firstTs: Date.now(),
    tp1Done: false,
    plan: row.plan || {},
    prot: { high: row.priceUsd || 0, entryLiq: row.liq ?? null, runner: false },
    stopArm: { ticks: 0, since: 0 },
    tpStreak: 0
  };
  state.data.positions.push(pos);
  state.data.fills.push({ ts: Date.now(), side: 'buy', status: 'confirmed', mode: row.mode, mint: row.mint, symbol: row.symbol || '', sol: row.sol || 0, usd: row.usd || 0, tokenAmount: row.tokenAmount || 0, priceUsd: row.priceUsd || 0, sig: row.sig || '', auto: true, feeSol: row.feeSol || 0 });
  state.data.fills = state.data.fills.slice(-400);
  if (row.mode === 'scalp' || row.mode === 'degen') {
    const led = state.data.ledgers[row.mode];
    const feeUsd = row.feeUsd || 0;
    const spend = (row.mode === 'degen' ? (row.plan?.degenUsd || row.usd || CAPS.degenTradeUsd) : (row.usd || 0)) + (row.mode === 'degen' ? feeUsd : 0);
    const usd = row.mode === 'scalp' ? (row.usd || 0) : spend;
    led.balanceUsd = usd6(led.balanceUsd - usd);
    led.trades.push({ ts: Date.now(), side: 'buy', mint: row.mint, symbol: row.symbol || '', usd: usd6(usd), feeUsd: usd6(feeUsd), tokenAmount: row.tokenAmount || 0, sig: row.sig || '' });
    led.trades = led.trades.slice(-200);
  }
  state.save();
  return pos;
}

export function recordSell(state, pos, row) {
  const sold = Math.min(pos.qty || 0, row.tokenAmount || pos.qty || 0);
  const frac = pos.qty > 0 ? Math.min(1, sold / pos.qty) : 1;
  pos.qty = Math.max(0, (pos.qty || 0) - sold);
  if (row.tag === 'tp1') pos.tp1Done = true;
  if (frac > 0.98 || pos.qty <= (row.fullQty || pos.qty) * 0.001) pos.open = false;
  if (!pos.open) pos.qty = 0;
  state.data.fills.push({ ts: Date.now(), side: 'sell', status: 'confirmed', mode: pos.mode, mint: pos.mint, symbol: pos.symbol, sol: row.sol || 0, usd: row.usd || 0, tokenAmount: sold, priceUsd: row.priceUsd || 0, sig: row.sig || '', auto: true, tag: row.tag || '', feeSol: row.feeSol || 0 });
  state.data.fills = state.data.fills.slice(-400);
  if (pos.mode === 'scalp' || pos.mode === 'degen') {
    const led = state.data.ledgers[pos.mode];
    const { pnlUsd } = applyPnl(led, pos.mint, sold, row.usd || 0);
    led.trades.push({ ts: Date.now(), side: 'sell', mint: pos.mint, symbol: pos.symbol, usd: usd6(row.usd || 0), tokenAmount: sold, pnlUsd, sig: row.sig || '', tag: row.tag || '' });
    led.trades = led.trades.slice(-200);
    if (pos.mode === 'scalp') noteScalpClose(state, pos.mint, pnlUsd);
    if (pos.mode === 'degen' && !pos.open) state.data.degenCd[pos.mint] = Date.now() + 60 * 60e3;
  }
  state.save();
}

function applyPnl(led, mint, tokens, usdBack) {
  let lotTokens = 0, cost = 0;
  for (const t of led.trades || []) {
    if (t.mint !== mint) continue;
    if (t.side === 'buy') { lotTokens += +t.tokenAmount || 0; cost += +t.usd || 0; }
    else if (lotTokens > 0 && +t.tokenAmount > 0) {
      const f = Math.min(1, (+t.tokenAmount) / lotTokens);
      cost *= 1 - f;
      lotTokens = Math.max(0, lotTokens - +t.tokenAmount);
    }
  }
  const costOut = lotTokens > 0 && tokens > 0 ? cost * Math.min(1, tokens / lotTokens) : 0;
  led.balanceUsd = usd6(led.balanceUsd + usdBack);
  led.realizedUsd = usd6((led.realizedUsd || 0) + usdBack - costOut);
  return { pnlUsd: usd6(usdBack - costOut) };
}

function noteScalpClose(state, mint, pnlUsd) {
  const log = state.data.scalpLog;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now());
  if (log.dayKey !== day) { log.dayKey = day; log.pausesToday = 0; log.counts = {}; if (log.haltDay && log.haltDay !== day) log.haltDay = ''; }
  log.cooldowns = log.cooldowns || {};
  log.counts = log.counts || {};
  log.cooldowns[mint] = Date.now() + (pnlUsd < 0 ? 15 * 60e3 : 60e3);
  const c = log.counts[mint] || { day, n: 0 };
  log.counts[mint] = { day, n: (c.day === day ? c.n : 0) + 1 };
  if (pnlUsd < 0) {
    log.streak = (log.streak || 0) + 1;
    if (log.streak >= 3) {
      log.streak = 0;
      log.pausesToday = (log.pausesToday || 0) + 1;
      log.pauseUntil = Date.now() + 30 * 60e3;
      if (log.pausesToday >= 2) log.haltDay = day;
    }
  } else log.streak = 0;
}
