import { tapeFromDex } from './net.js';
import { CAPS, ceilingBreakSignal, fakeDataReason, h1BreakSignal, h1TrendHold, htfRetestSignal, keptForFees, lhBreakSignal, listWalletSize, liveConfidence, livePreReason, noteRugDrop, planTriggerHit, planUsable, pushSolSample, quoteImpact, resolveSolM15, scalpContext, scalpDayBlock, scalpDexOk, scalpEntryFail, scalpExitReason, scalpSizeUsd, scalpSolBlockReason, SCALP, degenExitDecision, degenPotLimits } from './rules.js';
import { isNum, log, tehranDayKey, WSOL } from './util.js';

function pairTape(p) { return tapeFromDex(p); }

export function createEngine(cfg, state, net, swap) {
  const prices = new Map();
  const liqMem = new Map();
  function liqDrop(mint, liq) {
    if (!mint || !(liq > 0)) return '';
    const now = Date.now();
    let rows = (liqMem.get(mint) || []).filter(x => x && now - x.t <= 10 * 60e3);
    let hi = 0;
    for (const s of rows) if (now - s.t >= 1000 && s.liq > hi) hi = s.liq;
    rows.push({ t: now, liq });
    liqMem.set(mint, rows.slice(-40));
    if (liqMem.size > 80) liqMem.delete(liqMem.keys().next().value);
    if (hi > 0 && liq <= hi * 0.7) return 'liquidity dropped >30% in 10m';
    return '';
  }
  let agents = {};
  let sol = { price: null, h1: null, m5: null, m15: null, m15Source: '', m15at: 0, at: 0 };
  const solRing = [];
  const solLogged = new Set();
  let recentScan = [];
  let h1Cursor = 0;
  const breakViews = new Map();
  let busy = false;
  const agentRows = {};

  function bookView() {
    return { blacklist: { ...(agents.blacklist || {}), ...(state.data.blacklist || {}) }, degenPicks: agents.degen?.picks || [], agentRows };
  }
  function live(mint) { return prices.get(mint) || null; }
  function watchMints() {
    const set = new Set(state.open().map(p => p.mint));
    for (const t of agents.mylist?.tokens || []) if (t?.mint) set.add(t.mint);
    for (const p of agents.plans?.plans || []) if (p?.mint) set.add(p.mint);
    for (const c of agents.candidates?.candidates || []) if (c?.mint) set.add(c.mint);
    for (const p of agents.degen?.picks || []) if (p?.mint) set.add(p.mint);
    return [...set].slice(0, 50);
  }
  function indexAgents() {
    for (const k of Object.keys(agentRows)) delete agentRows[k];
    const add = (mint, row) => { if (!mint) return; (agentRows[mint] = agentRows[mint] || []).push(row); };
    for (const p of agents.degen?.picks || []) add(p.mint, p);
    for (const p of agents.plans?.plans || []) add(p.mint, p);
    for (const c of agents.candidates?.candidates || []) add(c.mint, c);
    for (const t of agents.mylist_scores?.tokens || []) add(t.mint, t);
    for (const t of agents.mylist?.tokens || []) add(t.mint, t);
    for (const p of agents.risk?.positions || []) add(p.mint, p);
  }
  function asList(data, key) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.[key])) return data[key];
    return [];
  }
  function seedBlacklist(data) {
    const out = {};
    for (const row of asList(data, 'mints')) {
      const mint = typeof row === 'string' ? row : row?.mint;
      if (mint) out[mint] = { why: (row && row.why) || 'seed rug', symbol: row?.symbol || '' };
    }
    return out;
  }
  async function refreshAgents() {
    try {
      const raw = await net.agents();
      agents = {
        sha: raw.sha || '',
        degen: { picks: asList(raw.degen, 'picks'), pot: raw.degen?.pot || {} },
        plans: { plans: asList(raw.plans, 'plans') },
        candidates: { candidates: asList(raw.candidates, 'candidates') },
        mylist: { tokens: asList(raw.mylist, 'tokens') },
        mylist_scores: { tokens: asList(raw.mylist_scores, 'tokens') },
        risk: raw.risk && typeof raw.risk === 'object' ? raw.risk : {},
        blacklist: seedBlacklist(raw.blacklist)
      };
      indexAgents();
      log('agents', 'read ' + (agents.sha || '').slice(0, 8));
    } catch (e) { log('agents', e.message || e); }
  }
  async function refreshPrices() {
    const mints = watchMints();
    if (!mints.length) return;
    const best = await net.dex(mints);
    for (const [mint, p] of best) {
      const t = pairTape(p);
      prices.set(mint, t);
      if (t.liq > 0) liqDrop(mint, t.liq);
      if (noteRugDrop(state.data, mint, t.px, t.h1)) {
        state.note('safety', mint, t.symbol, 'fake-data: blacklisted rug');
        log('safety', (t.symbol || mint.slice(0, 4)) + ' blacklisted after -80%');
      }
    }
    state.touch();
  }
  function logSolOnce(msg) {
    if (solLogged.has(msg)) return;
    solLogged.add(msg);
    log('scalp', msg);
  }
  async function refreshSol() {
    const now = Date.now();
    const m15Fresh = now - (sol.m15at || 0) < 60000;
    if (now - (sol.at || 0) < 20000 && sol.price && m15Fresh) return sol;
    const next = await net.sol();
    if (next.price > 0) pushSolSample(solRing, next.price, now);
    const h1 = isNum(next.h1) ? next.h1 : (isNum(sol.h1) ? sol.h1 : null);
    const m5 = isNum(next.m5) ? next.m5 : (isNum(sol.m5) ? sol.m5 : null);
    let m15 = sol.m15;
    let m15Source = sol.m15Source || '';
    let m15at = sol.m15at || 0;
    if (!m15Fresh) {
      let candles = null;
      if (next.pool) {
        try { candles = await net.ohlcv(next.pool, '15m'); }
        catch { candles = null; }
      }
      const resolved = resolveSolM15({ candles, samples: solRing, m5, h1, now });
      m15 = resolved.m15;
      m15Source = resolved.m15Source;
      m15at = now;
      if (!m15Source) logSolOnce('SOL 15m unknown');
    }
    if (h1 == null) logSolOnce('SOL 1h unknown');
    sol = { price: next.price || sol.price || null, h1, m5, pool: next.pool || sol.pool || '', m15, m15Source, m15at, at: now };
    return sol;
  }
  function guard(mint, tape) {
    const why = fakeDataReason(mint, tape, bookView());
    return why;
  }
  function liveTestTake(solAmt) {
    if (state.data.liveTest !== true) return { ok: true, sol: solAmt, test: false };
    if (state.data.positions.some(p => p.open && p.plan?.test)) return { ok: false, sol: 0, test: true, reason: 'live test position open' };
    const px = sol.price || 0;
    if (!(px > 0)) return { ok: false, sol: 0, test: true, reason: 'SOL price unavailable' };
    const sized = Math.min(+solAmt || 0, 3 / px);
    if (!(sized >= 0.001)) return { ok: false, sol: 0, test: true, reason: 'test size under 0.001 SOL' };
    return { ok: true, sol: +sized.toFixed(6), test: true, usd: Math.min(3, sized * px) };
  }
  async function safeBuy(mode, mint, symbol, solAmt, slipBps, plan, liq) {
    if (state.data.paused || !state.data.toggles[mode === 'scan' ? 'scan' : mode]) return;
    if (state.findOpen(mint)) { state.note(mode, mint, symbol, 'already open'); return; }
    const test = liveTestTake(solAmt);
    if (!test.ok) { state.note(mode, mint, symbol, test.reason); return; }
    solAmt = test.sol;
    plan = { ...(plan || {}), test: test.test };
    if (test.test && (mode === 'scan' || mode === 'degen')) plan.degenUsd = test.usd;
    if (test.test && mode === 'scalp') plan.scalpUsd = test.usd;
    const balNow = await swap.balance();
    const keep = keptForFees(CAPS.reserveSol);
    if (!(balNow >= solAmt + keep - 1e-9)) { state.note(mode, mint, symbol, 'reserve ' + keep.toFixed(3) + ' SOL'); return; }
    const tape = live(mint) || {};
    const fake = guard(mint, tape);
    if (fake) { state.note(mode, mint, symbol, fake); return; }
    const flags = await swap.mintFlags(mint);
    if (!flags.ok) { state.note(mode, mint, symbol, flags.reason || 'mint'); return; }
    const max = mode === 'scalp' ? SCALP.IMPACT_MAX : mode === 'breakout' ? 1 : mode === 'degen' || mode === 'scan' ? CAPS.degenImpact : 5;
    let bought;
    try { bought = await swap.buy(mint, solAmt, slipBps, max); }
    catch (e) {
      const msg = String(e.message || e);
      state.note(mode, mint, symbol, msg.startsWith('fake-data') || msg.startsWith('price impact') ? msg : 'fake-data: jupiter quote failed');
      log(mode, msg);
      return;
    }
    const px = sol.price || 0;
    const usd = solAmt * (px || 0);
    const tokenAmount = bought.tokenAmount || (bought.quote?.outAmount && flags.decimals != null ? +bought.quote.outAmount / 10 ** flags.decimals : 0);
    const priceUsd = tokenAmount > 0 && px > 0 ? usd / tokenAmount : (tape.px || 0);
    if (cfg.dryRun) {
      state.note(mode, mint, symbol, 'dry-run buy ' + solAmt + ' SOL · ' + (plan.reason || mode));
      return;
    }
    state.recordBuy({ mode: mode === 'scan' ? 'degen' : mode, mint, symbol, sol: solAmt, usd, tokenAmount, priceUsd, sig: bought.sig, plan, liq: liq ?? tape.liq, feeUsd: (bought.feeSol || 0) * (px || 0), feeSol: bought.feeSol || 0 });
    state.note(mode, mint, symbol, 'bought');
    log(mode, 'bought ' + (symbol || mint.slice(0, 4)));
  }

  async function scalpTick() {
    state.data.toggles.scalp = false;
    return;
    if (!state.data.toggles.scalp || state.data.paused) return;
    await refreshSol();
    const solMood = scalpSolBlockReason(sol);
    if (solMood) { state.note('scalp', 'SOL', 'SOL', solMood); return; }
    const block = scalpDayBlock(state.data);
    if (block) { state.note('scalp', '', '', block); return; }
    if (await scalpBreak1h()) return;
    const sized = scalpSizeUsd(state.data, state.data.positions, (m) => live(m)?.px);
    if (!(sized.usd >= SCALP.MIN_FREE)) { state.note('scalp', '', '', sized.label); return; }
    const ids = watchMints();
    const ranked = ids.map(mint => ({ mint, t: live(mint) })).filter(x => x.t && x.t.liq > 0).sort((a, b) => (b.t.vol24 || 0) - (a.t.vol24 || 0));
    let top = null;
    for (const row of ranked) {
      const fake = guard(row.mint, row.t);
      if (fake) { state.note('scalp', row.mint, row.t.symbol, fake); continue; }
      top = row;
      break;
    }
    if (!top) return;
    const logBook = state.data.scalpLog;
    const day = tehranDayKey();
    if (logBook.dayKey !== day) { logBook.dayKey = day; logBook.pausesToday = 0; logBook.counts = {}; }
    const cd = logBook.cooldowns?.[top.mint];
    if (cd > Date.now()) { state.note('scalp', top.mint, top.t.symbol, 'cooldown'); return; }
    const count = logBook.counts?.[top.mint];
    if (count && count.day === day && count.n >= SCALP.MAX_PER_DAY) { state.note('scalp', top.mint, top.t.symbol, '3 scalps today'); return; }
    const openOne = state.open('scalp');
    if (openOne.length === 1 && openOne[0].mint === top.mint) { state.note('scalp', top.mint, top.t.symbol, 'same token already open'); return; }
    let bars;
    try {
      bars = { m1: await net.ohlcv(top.t.pool, '1m'), m15: await net.ohlcv(top.t.pool, '15m'), h1: await net.ohlcv(top.t.pool, '1h') };
    } catch (e) { state.note('scalp', top.mint, top.t.symbol, 'candles unavailable'); return; }
    const resist = (agents.plans?.plans || []).find(p => p.mint === top.mint);
    const ctx = scalpContext(bars, top.t.px, {
      ageH: top.t.ageH, curve: /pumpfun|bonding/i.test(top.t.dex) && !/pumpswap/i.test(top.t.dex),
      dexOk: scalpDexOk(top.t.dex), liq: top.t.liq, vol24: top.t.vol24, m5: top.t.m5, h1: top.t.h1,
      buys: top.t.m5b, sells: top.t.m5s, resist: +resist?.trigger_price || 0, flag: ''
    });
    const why = scalpEntryFail(ctx);
    if (why) { state.note('scalp', top.mint, top.t.symbol, why); return; }
    if (!(sol.price > 0)) { state.note('scalp', top.mint, top.t.symbol, 'SOL price unavailable'); return; }
    const solAmt = +((sized.usd) / sol.price).toFixed(6);
    const bal = await swap.balance();
    if (solAmt + CAPS.reserveSol > bal) { state.note('scalp', top.mint, top.t.symbol, 'insufficient SOL'); return; }
    let q;
    try { q = await swap.quote(WSOL, top.mint, BigInt(Math.round(solAmt * 1e9)), SCALP.SLIP_BPS); }
    catch { state.note('scalp', top.mint, top.t.symbol, 'fake-data: jupiter quote failed'); return; }
    const impact = quoteImpact(q);
    if (!impact.ok) { state.note('scalp', top.mint, top.t.symbol, impact.reason); return; }
    ctx.impact = impact.pct;
    let drift = null;
    try {
      const flags = await swap.mintFlags(top.mint);
      const tokens = flags.decimals != null ? +q.outAmount / 10 ** flags.decimals : 0;
      const implied = tokens > 0 ? (solAmt * sol.price) / tokens : 0;
      if (implied > 0 && top.t.px > 0) drift = implied / top.t.px - 1;
    } catch { drift = null; }
    ctx.drift = drift;
    const why2 = scalpEntryFail(ctx);
    if (why2) { state.note('scalp', top.mint, top.t.symbol, why2); return; }
    await safeBuy('scalp', top.mint, top.t.symbol, solAmt, SCALP.SLIP_BPS, { breakLow: ctx.breakLow, entryLiq: ctx.liq, pool: top.t.pool, reason: 'scalp breakout' }, ctx.liq);
  }

  async function scalpBreak1h() {
    const ids = [...new Set([...watchMints(), ...recentScan])];
    if (!ids.length || !(sol.price > 0)) return false;
    const start = h1Cursor % ids.length;
    h1Cursor += 4;
    for (let n = 0; n < 4 && n < ids.length; n++) {
      const mint = ids[(start + n) % ids.length];
      const tape = live(mint);
      if (!tape?.pool) continue;
      let h1;
      try { h1 = await net.ohlcv(tape.pool, '1h', mint); } catch { continue; }
      const liveSig = h1BreakSignal(h1, Date.now(), tape.px);
      const sig = liveSig.buy ? liveSig : h1TrendHold(h1, Date.now());
      if (!sig.buy) continue;
      const fake = guard(mint, tape);
      if (fake) { state.note('scalp', mint, tape.symbol, fake); continue; }
      const day = tehranDayKey();
      const logBook = state.data.scalpLog;
      if (logBook.cooldowns?.[mint] > Date.now()) continue;
      const count = logBook.counts?.[mint];
      if (count && count.day === day && count.n >= SCALP.MAX_PER_DAY) continue;
      if (state.open('scalp').length >= SCALP.MAX_OPEN) return false;
      state.data.seenH1 = state.data.seenH1 || {};
      if (state.data.seenH1[mint] === sig.key) continue;
      const solAmt = +(CAPS.listUsd / sol.price).toFixed(6);
      const bal = await swap.balance();
      if (solAmt + CAPS.reserveSol > bal) { state.note('scalp', mint, tape.symbol, 'insufficient SOL'); return false; }
      state.data.seenH1[mint] = sig.key;
      const hold = sig.kind === 'trendhold1h';
      await safeBuy('scalp', mint, tape.symbol, solAmt, SCALP.SLIP_BPS, { scalp: true, kind: hold ? 'trendhold1h' : 'breakout1h', scalpUsd: CAPS.listUsd, stop: sig.stop, pool: tape.pool, entryLiq: tape.liq, reason: hold ? 'scalp trend hold' : 'scalp 1h breakout' }, tape.liq);
      return true;
    }
    return false;
  }

  function mainOpenCount() {
    return state.open().filter(p => p.mode === 'breakout' || p.mode === 'plans' || p.mode === 'plan').length;
  }

  async function breakoutTick() {
    if (!state.data.toggles.breakout || state.data.paused) return;
    const rows = agents.mylist?.tokens || [];
    if (!rows.length) return;
    const openN = mainOpenCount();
    if (openN >= 2) { state.note('breakout', '', '', 'max 2 open'); return; }
    const cursor = state.data.breakCursor || 0;
    const row = rows[cursor % rows.length];
    state.data.breakCursor = cursor + 1;
    const tape = live(row.mint);
    if (!tape?.pool) return;
    let h1 = [];
    let m15 = [];
    try { h1 = await net.ohlcv(tape.pool, '1h', row.mint); } catch { return; }
    try { m15 = (await net.ohlcv(tape.pool, '15m', row.mint)).slice(-96); } catch { m15 = []; }
    let h4 = [];
    try { h4 = (await net.ohlcv(tape.pool, '4h', row.mint)).slice(-80); } catch { h4 = []; }
    const now = Date.now();
    const liveSig = h1BreakSignal(h1, now, tape.px);
    const hold = h1TrendHold(h1, now);
    const ceiling = ceilingBreakSignal(h1, m15, now);
    const lh = lhBreakSignal(h1, m15, now, tape.px);
    let htf = htfRetestSignal(h4, h1, now, 4 * 3600e3);
    if (!htf.lastLH) {
      try {
        const d1 = (await net.ohlcv(tape.pool, '1d', row.mint)).slice(-80);
        const alt = htfRetestSignal(d1, h1, now, 24 * 3600e3);
        if (alt.lastLH) htf = alt;
      } catch { /* 4h stands */ }
    }
    const sig = liveSig.buy ? liveSig : hold.buy ? hold : ceiling.buy ? ceiling : lh.buy ? lh : htf.buy ? htf : liveSig;
    breakViews.set(row.mint, {
      mint: row.mint, symbol: row.symbol || tape.symbol || '', fa: liveSig.fa || (htf.phase ? 'HTF retest' : '') || (lh.broken ? 'LH break' : ''),
      kind: sig.kind || (sig.buy ? 'breakout1h' : ''), zoneLo: liveSig.zoneLo || ceiling.ceilingLo, zoneHi: liveSig.zoneHi || ceiling.ceilingHi,
      lastLH: lh.lastLH || htf.lastLH, line: htf.line || lh.line || liveSig.line, hl: lh.hl || htf.hl, ceilingLo: ceiling.ceilingLo, ceilingHi: ceiling.ceilingHi,
      htf: htf.phase || '', htfLevel: htf.level, stop: sig.stop, target: sig.target || (sig.entry ? sig.entry * 1.3 : liveSig.target), entry: sig.entry, state: sig.buy ? 'buy' : liveSig.state, broken: !!lh.broken
    });
    if (breakViews.size > 40) breakViews.delete(breakViews.keys().next().value);
    if (!sig.buy) return;
    if (state.findOpen(row.mint)) { state.note('breakout', row.mint, row.symbol || tape.symbol, 'already open'); return; }
    const fake = guard(row.mint, tape);
    if (fake) { state.note('breakout', row.mint, row.symbol || tape.symbol, fake); return; }
    state.data.seenBreaks = state.data.seenBreaks || {};
    if (state.data.seenBreaks[row.mint] === sig.key) return;
    const bal = await swap.balance();
    const sized = listWalletSize(bal, CAPS.reserveSol, openN);
    if (!(sized.sol > 0)) { state.note('breakout', row.mint, row.symbol || tape.symbol, sized.label); return; }
    state.data.seenBreaks[row.mint] = sig.key;
    const kind = sig.kind || 'breakout1h';
    const plan = { myList: true, mlBreak: true, mlBreakKey: sig.key, kind, stop: sig.stop, tp: (sig.entry || tape.px) * 1.3, reason: kind, exit: { stopPx: sig.stop, tps: [{ gainPct: 30, sellPct: 100 }] } };
    await safeBuy('breakout', row.mint, row.symbol || tape.symbol, sized.sol, 100, plan, tape.liq);
  }

  async function plansTick() {
    if (!state.data.toggles.plans || state.data.paused) return;
    if (agents.risk?.pause_auto_buy) { state.note('plans', '', '', 'agent risk paused buys'); return; }
    await refreshSol();
    const bal = await swap.balance();
    const openN = mainOpenCount();
    if (openN >= 2) { state.note('plans', '', '', 'max 2 open'); return; }
    for (const p of agents.plans?.plans || []) {
      if (!planUsable(p)) continue;
      const tape = live(p.mint);
      if (!tape || !(tape.px > 0)) continue;
      const fake = guard(p.mint, tape);
      if (fake) { state.note('plans', p.mint, p.symbol, fake); continue; }
      if (!planTriggerHit(p, tape.px)) continue;
      const stamp = String(p.trigger_price || '') + ':' + String(p.ts || p.updatedAt || '');
      state.data.seenPlans = state.data.seenPlans || {};
      if (state.data.seenPlans[p.mint] === stamp) continue;
      const sized = listWalletSize(bal, CAPS.reserveSol, openN);
      if (!(sized.sol > 0)) { state.note('plans', p.mint, p.symbol, sized.label); return; }
      state.data.seenPlans[p.mint] = stamp;
      await safeBuy('plans', p.mint, p.symbol || tape.symbol, sized.sol, 100, { agent: true, stop: +p.stop || null, tp1: +p.tp1 || null, tp2: +p.tp2 || null, reason: 'agent plan ' + (p.setup || '') }, tape.liq);
      return;
    }
  }

  async function scanTick() {
    if (!state.data.toggles.scan && !state.data.toggles.degen) return;
    if (state.data.paused || !state.data.toggles.scan) return;
    const lim = degenPotLimits(agents.degen?.pot);
    const led = state.data.ledgers.degen;
    const openDegen = state.open('degen');
    if (openDegen.length >= lim.maxOpen) { state.note('scan', '', '', 'max ' + lim.maxOpen + ' open'); return; }
    const deployed = openDegen.reduce((s, p) => s + (p.costUsd || 0), 0);
    if (deployed + lim.tradeUsd > lim.budgetUsd + 1e-6) { state.note('scan', '', '', 'pot deployed cap'); return; }
    if (led.balanceUsd + 1e-9 < lim.tradeUsd + 0.25) { state.note('scan', '', '', 'Degen out of funds'); return; }
    let rows = [];
    try { rows = await net.newPools(); } catch (e) { state.note('scan', '', '', e.message || 'source failed'); return; }
    recentScan = rows.map(r => r && r.mint).filter(Boolean).slice(0, 20);
    let looked = 0;
    for (const raw of rows.slice(0, 20)) {
      const ageH = raw.created ? (Date.now() - raw.created) / 3.6e6 : null;
      if (!(isNum(ageH) && ageH < 6 && isNum(raw.liq) && raw.liq >= 40000)) continue;
      if (looked >= 3) break;
      looked++;
      let tape = live(raw.mint);
      if (!tape?.h1b) {
        const best = await net.dex([raw.mint]);
        const p = best.get(raw.mint);
        if (p) { tape = pairTape(p); prices.set(raw.mint, tape); }
      }
      tape = tape || { ...raw, m5: null, h1: null, vol24: null, mcap: null, h1b: 0, h1s: 0, h1vol: 0, m5b: raw.m5b, m5s: raw.m5s };
      const fake = guard(raw.mint, tape);
      if (fake) { state.note('scan', raw.mint, raw.symbol, fake); continue; }
      const pre = livePreReason({ ...tape, ageH: tape.ageH ?? ageH, m5vol: tape.m5vol || raw.m5vol, h1vol: tape.h1vol });
      if (pre) { state.note('scan', raw.mint, raw.symbol, pre); continue; }
      const pick = (agents.degen?.picks || []).find(x => x.mint === raw.mint);
      if (pick && !(pick.entry_now === true || pick.entry_now === 'true') && /\breject\b|\bwash\b/i.test(String(pick.reason || ''))) {
        state.note('scan', raw.mint, raw.symbol, 'hunter: ' + String(pick.reason).slice(0, 80));
        continue;
      }
      const conf = liveConfidence(tape);
      if (conf < 60) { state.note('scan', raw.mint, raw.symbol, 'confidence ' + conf + ' < 60'); continue; }
      const listed = (agents.degen?.picks || []).find(x => x && x.mint === raw.mint);
      if (!listed) { state.note('scan', raw.mint, raw.symbol, 'not in degen.json'); continue; }
      await refreshSol();
      if (!(sol.price > 0)) return;
      const drop = liqDrop(raw.mint, tape.liq);
      if (drop) { state.note('scan', raw.mint, raw.symbol, drop); continue; }
      const solAmt = +(lim.tradeUsd / sol.price).toFixed(6);
      const bal = await swap.balance();
      if (solAmt + CAPS.reserveSol > bal) { state.note('scan', raw.mint, raw.symbol, 'insufficient SOL'); return; }
      await safeBuy('scan', raw.mint, raw.symbol || tape.symbol, solAmt, 300, { degen: true, stopPct: 25, timeStopMin: 45, trail: 20, reason: 'live scan · conf ' + conf, degenUsd: lim.tradeUsd }, tape.liq);
      return;
    }
  }

  async function exits() {
    await refreshSol();
    const pxSol = sol.price || 0;
    for (const p of state.open()) {
      const tape = live(p.mint) || {};
      const lp = tape.px;
      if (!(lp > 0)) continue;
      let decision = null;
      if (p.mode === 'scalp') {
        let candles = [];
        try { if (p.plan?.pool) candles = await net.ohlcv(p.plan.pool, '1m'); } catch { candles = []; }
        const why = scalpExitReason(p, lp, candles, { liq: tape.liq, m5b: tape.m5b, m5s: tape.m5s });
        if (why) decision = { pct: 100, tag: why, reason: why };
      } else if (p.mode === 'degen') {
        decision = degenExitDecision(p, lp, { liq: tape.liq, m5b: tape.m5b, m5s: tape.m5s });
      } else if (p.mode === 'breakout') {
        const entry = p.avgUsd;
        const high = Math.max(p.prot?.high || 0, entry || 0, lp);
        p.prot = { ...(p.prot || {}), high };
        let stop = +p.plan?.stop || 0;
        if (entry > 0 && high >= entry * 1.2) stop = Math.max(stop, entry * 1.05);
        const tp = entry > 0 ? entry * 1.3 : (+p.plan?.tp || 0);
        if (stop > 0 && lp <= stop) decision = { pct: 100, tag: 'stop', reason: entry > 0 && high >= entry * 1.2 && stop >= entry * 1.05 - 1e-12 ? '+5% stop' : 'chart stop' };
        else if (tp > 0 && lp >= tp) decision = { pct: 100, tag: 'tp', reason: 'tp +30%' };
      } else if (p.mode === 'plans') {
        const stop = +p.plan?.stop || (p.avgUsd > 0 ? p.avgUsd * 0.85 : 0);
        const tp1 = +p.plan?.tp1 || (p.avgUsd > 0 ? p.avgUsd * 1.15 : 0);
        if (stop > 0 && lp <= stop) decision = { pct: 100, tag: 'stop', reason: 'plan stop' };
        else if (!p.tp1Done && tp1 > 0 && lp >= tp1) decision = { pct: 50, tag: 'tp1', reason: 'plan tp1' };
        else if (p.tp1Done && +p.plan?.tp2 > 0 && lp >= +p.plan.tp2) decision = { pct: 100, tag: 'tp2', reason: 'plan tp2' };
      }
      if (!decision) continue;
      if (state.data.paused) { state.note(p.mode, p.mint, p.symbol, 'paused · would ' + decision.reason); continue; }
      try {
        const held = await swap.tokenRaw(p.mint);
        const part = decision.pct >= 100 ? held.raw : (held.raw * BigInt(decision.pct)) / 100n;
        if (part <= 0n) continue;
        const sold = await swap.sell(p.mint, part, decision.reason === 'liquidity pull' ? 400 : 200);
        const solOut = sold.solOut || (+sold.quote?.outAmount || 0) / 1e9;
        const usd = solOut * (pxSol || 0);
        if (cfg.dryRun) { state.note(p.mode, p.mint, p.symbol, 'dry-run exit ' + decision.reason); continue; }
        const full = held.ui || p.qty || 0;
        const tokens = decision.pct >= 100 ? full : full * decision.pct / 100;
        state.recordSell(p, { tokenAmount: tokens, fullQty: full, sol: solOut, usd, priceUsd: lp, sig: sold.sig, tag: decision.tag, feeSol: sold.feeSol || 0 });
        state.note(p.mode, p.mint, p.symbol, decision.reason);
        log(p.mode, 'exit ' + (p.symbol || '') + ' ' + decision.reason);
      } catch (e) { log(p.mode, 'sell failed ' + (e.message || e)); }
    }
    state.touch();
  }

  async function tick(kind) {
    if (busy) return;
    busy = true;
    try {
      if (kind === 'agents') await refreshAgents();
      else if (kind === 'prices') { await refreshPrices(); await exits(); }
      else if (kind === 'scalp') await scalpTick();
      else if (kind === 'breakout') await breakoutTick();
      else if (kind === 'plans') await plansTick();
      else if (kind === 'scan') await scanTick();
    } catch (e) { log(kind, e.message || e); }
    finally { busy = false; }
  }

  function planZone(p) {
    const z = p?.leg2_zone;
    if (Array.isArray(z) && +z[0] > 0 && +z[1] > 0) return { lo: Math.min(+z[0], +z[1]), hi: Math.max(+z[0], +z[1]) };
    const t = +p?.trigger_price;
    if (t > 0) return { lo: t, hi: t };
    return { lo: null, hi: null };
  }
  function signalState(mint, zone, px) {
    if (state.data.positions.some(p => p.open && p.mint === mint)) return 'bought';
    const fills = (state.data.fills || []).filter(f => f && f.mint === mint && f.status === 'confirmed');
    const last = fills[fills.length - 1];
    if (last && last.side === 'sell') return 'sold';
    if (px > 0 && zone.lo && zone.hi && px + 1e-12 >= Math.min(zone.lo, zone.hi) && px <= Math.max(zone.lo, zone.hi) * 1.0000001) return 'touched';
    return 'waiting';
  }
  function status() {
    const d = state.data;
    const pos = d.positions.filter(p => p.open).map(p => ({
      mode: p.mode, mint: p.mint, symbol: p.symbol, qty: p.qty, avgUsd: p.avgUsd,
      px: live(p.mint)?.px || null, pnlPct: p.avgUsd > 0 && live(p.mint)?.px ? (live(p.mint).px / p.avgUsd - 1) * 100 : null
    }));
    const plans = agents.plans?.plans || [];
    const signals = plans.filter(p => p && p.mint).slice(0, 40).map(p => {
      const zone = planZone(p);
      const px = live(p.mint)?.px || null;
      return {
        mint: p.mint, symbol: p.symbol || '', conf: isNum(+p.confidence) ? +p.confidence : null,
        zoneLo: zone.lo, zoneHi: zone.hi, stop: +p.stop > 0 ? +p.stop : null,
        target: +p.tp1 > 0 ? +p.tp1 : (+p.target > 0 ? +p.target : null),
        price: px, state: signalState(p.mint, zone, px)
      };
    });
    const executions = (d.fills || []).slice(-12).reverse().map(f => ({
      ts: f.ts, side: f.side, symbol: f.symbol || '', mint: f.mint, mode: f.mode || '',
      price: f.priceUsd || null, sig: f.sig || '', url: f.sig ? 'https://solscan.io/tx/' + f.sig : ''
    }));
    return {
      ok: true, paused: !!d.paused, dryRun: !!cfg.dryRun, liveTest: false, pubkey: swap.owner,
      toggles: d.toggles, positions: pos, signals, executions,
      breaks: [...breakViews.values()].slice(0, 40),
      ledgers: { scalp: d.ledgers.scalp, degen: d.ledgers.degen },
      decisions: d.decisions.slice(0, 20),
      blacklist: Object.keys(d.blacklist || {}).length,
      sol, agentsSha: agents.sha || '', at: Date.now()
    };
  }

  return { tick, status, refreshAgents, refreshPrices };
}
