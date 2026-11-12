/* Wild Degen Fast — paper only.
   The engine runs inside a Worker built from the string below.
   That worker is created with no page functions in its scope, so it cannot
   reach the signer, a swap, the burner, the vault, or the real Degen pot.
   The only storage key this file writes is sms:fastpaper. */
(function () {
  var LS = 'sms:fastpaper';
  var SRC = [
    "'use strict';",
    "var S = null;",
    "var ws = null, wsTry = 0, wsTimer = 0, dexTimer = 0, pxTimer = 0, rugBusy = 0;",
    "var rugQ = [], rugCache = {}, series = {}, solPx = 0, retries = {};",
    "function post() { postMessage({ type: 'state', state: snap() }); }",
    "function say(text) { postMessage({ type: 'toast', text: text }); }",
    "function num(v) { var n = +v; return n === n ? n : 0; }",
    "function snap() {",
    "  return { on: S.on, settings: S.settings, cash: S.cash, start: S.start, realized: S.realized,",
    "    scanned: S.scanned, dodged: S.dodged, bought: S.bought, wins: S.wins, exited: S.exited,",
    "    open: S.open, closed: S.closed.slice(0, 24), equity: S.equity.slice(-800), last: S.last, ws: S.ws, rej: S.rej || {}, block: S.block || {} };",
    "}",
    "function markValue() {",
    "  var drag = (num(S.settings.slipPct) + num(S.settings.feePct)) / 100;",
    "  var mtm = 0, i;",
    "  for (i = 0; i < S.open.length; i++) {",
    "    var p = S.open[i];",
    "    var px = p.lastPx > 0 ? p.lastPx : p.entryPx;",
    "    mtm += p.qtyLeft * px * (1 - drag);",
    "  }",
    "  return S.cash + mtm;",
    "}",
    "function pushEq(dot) {",
    "  var v = Math.round(markValue() * 100) / 100;",
    "  var now = Date.now();",
    "  var last = S.equity[S.equity.length - 1];",
    "  if (!dot && last && now - last.t < 12000) { last.v = v; return; }",
    "  S.equity.push({ t: now, v: v, dot: dot || '' });",
    "  if (S.equity.length > 800) S.equity.splice(0, S.equity.length - 800);",
    "}",
    "onmessage = function (ev) {",
    "  var m = ev.data || {};",
    "  if (m.type === 'boot') { S = m.state; rugQ = (S.pending || []).slice(); if (S.on) start(); post(); }",
    "  else if (m.type === 'on') { S.on = true; start(); post(); }",
    "  else if (m.type === 'off') { S.on = false; stop(); post(); }",
    "  else if (m.type === 'settings') { S.settings = m.settings; post(); }",
    "  else if (m.type === 'reset') { resetBook(); post(); }",
    "};",
    "function resetBook() {",
    "  var start = num(S.settings.startUsd) || 100;",
    "  S.cash = start; S.start = start; S.realized = 0;",
    "  S.open = []; S.closed = []; S.equity = [{ t: Date.now(), v: start, dot: '' }];",
    "  S.scanned = 0; S.dodged = 0; S.bought = 0; S.wins = 0; S.exited = 0;",
    "  S.seen = []; S.pending = []; S.watch = []; S.rej = {}; S.block = {};",
    "  S.last = { scan: 'Idle', rug: 'Idle', mom: 'Idle', exit: 'Idle' };",
    "  rugQ = []; series = {};",
    "}",
    "function start() {",
    "  connect();",
    "  if (!dexTimer) dexTimer = setInterval(pollDex, 30000);",
    "  if (!pxTimer) pxTimer = setInterval(pollPx, Math.max(2000, num(S.settings.pxMs) || 3000));",
    "  pollDex();",
    "  pumpRug();",
    "}",
    "function stop() {",
    "  if (ws) { try { ws.close(); } catch (e) {} ws = null; }",
    "  clearInterval(dexTimer); clearInterval(pxTimer); dexTimer = 0; pxTimer = 0;",
    "  clearTimeout(wsTimer); S.ws = 'off';",
    "}",
    "function connect() {",
    "  if (!S.on) return;",
    "  S.ws = 'connecting';",
    "  try { ws = new WebSocket('wss://pumpportal.fun/api/data'); }",
    "  catch (e) { schedule(); return; }",
    "  ws.onopen = function () {",
    "    wsTry = 0; S.ws = 'live';",
    "    ws.send(JSON.stringify({ method: 'subscribeNewToken' }));",
    "    ws.send(JSON.stringify({ method: 'subscribeMigration' }));",
    "    var oi; for (oi = 0; oi < S.open.length; oi++) watchMint(S.open[oi].mint);",
    "    S.last.scan = 'PumpPortal live';",
    "    post();",
    "  };",
    "  ws.onmessage = function (ev) { try { onPump(JSON.parse(ev.data)); } catch (e) {} };",
    "  ws.onclose = function () { ws = null; if (S.on) { S.ws = 'reconnect'; schedule(); } };",
    "  ws.onerror = function () { try { ws && ws.close(); } catch (e) {} };",
    "}",
    "function schedule() {",
    "  if (!S.on) return;",
    "  var wait = Math.min(30000, 1000 * Math.pow(2, wsTry));",
    "  wsTry++;",
    "  clearTimeout(wsTimer);",
    "  wsTimer = setTimeout(connect, wait);",
    "  S.last.scan = 'Reconnecting ' + Math.round(wait / 1000) + 's';",
    "  post();",
    "}",
    "function watchMint(mint) {",
    "  if (!ws || ws.readyState !== 1 || !mint) return;",
    "  try { ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [mint] })); } catch (e) {}",
    "}",
    "function onPump(msg) {",
    "  if (!msg) return;",
    "  var mint = msg.mint || msg.tokenAddress;",
    "  if (!mint) return;",
    "  var held = null, hi;",
    "  for (hi = 0; hi < S.open.length; hi++) if (S.open[hi].mint === mint) held = S.open[hi];",
    "  if (held && num(msg.solAmount) > 0 && num(msg.tokenAmount) > 0 && solPx > 0) {",
    "    var live = (num(msg.solAmount) / num(msg.tokenAmount)) * solPx;",
    "    if (live > 0 && held.lastPx > 0 && live < held.lastPx * 3 && live > held.lastPx / 3) { held.lastPx = live; markExit(held, live, Date.now()); post(); }",
    "  }",
    "  if (held) return;",
    "  noteMint(mint, msg.symbol || msg.name || mint.slice(0, 4), { src: msg.txType || 'pump', solMcap: num(msg.marketCapSol) });",
    "}",
    "var SKIP = { So11111111111111111111111111111111111111112: 1, EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 1 };",
    "function noteMint(mint, symbol, meta) {",
    "  if (!mint || SKIP[mint] || S.seen.indexOf(mint) >= 0) return;",
    "  S.seen.push(mint);",
    "  if (S.seen.length > 2000) S.seen.splice(0, S.seen.length - 1500);",
    "  S.scanned++;",
    "  S.pending.push(mint);",
    "  if (rugQ.length < 40) rugQ.push(mint);",
    "  series[mint] = { symbol: String(symbol || mint.slice(0, 4)).slice(0, 16), bars: [], ready: false, buys: 0, sells: 0, liq: 0, mcap: 0, created: 0 };",
    "  S.last.scan = series[mint].symbol + ' · ' + (meta.src || 'scan');",
    "  post();",
    "  if (!rugBusy) pumpRug();",
    "}",
    "function pollDex() {",
    "  if (!S.on) return;",
    "  var urls = ['https://api.dexscreener.com/token-boosts/latest/v1', 'https://api.dexscreener.com/token-boosts/top/v1', 'https://api.dexscreener.com/token-profiles/latest/v1'];",
    "  var added = 0;",
    "  urls.forEach(function (url) {",
    "    fetch(url).then(function (res) { return res.ok ? res.json() : []; }).then(function (rows) {",
    "      if (!S.on || !Array.isArray(rows)) return;",
    "      rows.forEach(function (row) {",
    "        if (!row || added > 20) return;",
    "        if (row.chainId && row.chainId !== 'solana') return;",
    "        if (!row.tokenAddress || S.seen.indexOf(row.tokenAddress) >= 0) return;",
    "        added++;",
    "        noteMint(row.tokenAddress, row.tokenAddress.slice(0, 4), { src: 'dex' });",
    "      });",
    "    }).catch(function () {});",
    "  });",
    "  fetch('https://api.dexscreener.com/tokens/v1/solana/So11111111111111111111111111111111111111112').then(function (res) { return res.ok ? res.json() : []; }).then(function (arr) {",
    "    var px = arr && arr[0] && num(arr[0].priceUsd);",
    "    if (px > 0) solPx = px;",
    "  }).catch(function () {});",
    "}",
    "function pumpRug() {",
    "  if (!S.on || rugBusy || !rugQ.length) return;",
    "  var mint = rugQ.shift();",
    "  if (rugCache[mint]) { pumpRug(); return; }",
    "  rugBusy = 1;",
    "  var row = series[mint];",
    "  fetch('https://api.rugcheck.xyz/v1/tokens/' + mint + '/report/summary').then(function (res) {",
    "    if (res.status === 429) { rugQ.unshift(mint); throw new Error('slow'); }",
    "    return res.ok ? res.json() : null;",
    "  }).then(function (summary) {",
    "    if (summary && summary.topHolders && summary.mintAuthority !== undefined) return { summary: summary, report: null };",
    "    return fetch('https://api.rugcheck.xyz/v1/tokens/' + mint + '/report').then(function (res) {",
    "      if (res.status === 429) { rugQ.unshift(mint); throw new Error('slow'); }",
    "      return res.ok ? res.json() : null;",
    "    }).then(function (report) { return { summary: summary, report: report }; });",
    "  }).then(function (pack) {",
    "    var verdict = judge(pack.summary, pack.report);",
    "    if (!verdict.ok && verdict.retry) {",
    "      retries[mint] = (retries[mint] || 0) + 1;",
    "      if (retries[mint] < 3) rugQ.push(mint);",
    "      else finishRug(mint, { ok: false, why: 'no rug report' });",
    "    } else finishRug(mint, verdict);",
    "  }).catch(function () { S.last.rug = 'RugCheck slow'; }).then(function () {",
    "    rugBusy = 0; post(); setTimeout(pumpRug, 1200);",
    "  });",
    "}",
    "function finishRug(mint, verdict) {",
    "  rugCache[mint] = verdict;",
    "  S.pending = (S.pending || []).filter(function (m) { return m !== mint; });",
    "  var row = series[mint];",
    "  var name = row && row.symbol || mint.slice(0, 4);",
    "  if (!verdict.ok) {",
    "    S.dodged++;",
    "    tally(mint, verdict.why);",
    "    S.last.rug = name + ' · ' + verdict.why;",
    "    say('Rug dodged ' + name + ' · ' + verdict.why);",
    "  } else {",
    "    if (row) row.ready = true;",
    "    if (S.watch.indexOf(mint) < 0) S.watch.push(mint);",
    "    if (S.watch.length > 40) S.watch.splice(0, S.watch.length - 40);",
    "    S.last.rug = name + ' passed';",
    "  }",
    "}",
    "function tally(mint, why) {",
    "  if (!why) return;",
    "  if (!S.rejOnce) S.rejOnce = {};",
    "  var key = mint + '|' + why;",
    "  if (S.rejOnce[key]) return;",
    "  S.rejOnce[key] = 1;",
    "  if (!S.rej) S.rej = {};",
    "  S.rej[why] = (S.rej[why] || 0) + 1;",
    "}",
    "function poolAddrs(src) {",
    "  var set = {}, i, m, markets = src.markets || [];",
    "  for (i = 0; i < markets.length; i++) {",
    "    m = markets[i];",
    "    if (!m) continue;",
    "    if (m.pubkey) set[m.pubkey] = 1;",
    "    if (m.mintLP) set[m.mintLP] = 1;",
    "    if (m.liquidityA) set[m.liquidityA] = 1;",
    "    if (m.liquidityB) set[m.liquidityB] = 1;",
    "  }",
    "  return set;",
    "}",
    "function judge(summary, report) {",
    "  var src = report || {};",
    "  if (!summary && !report) return { ok: false, why: 'no rug report', retry: true };",
    "  if (!report && !(summary && summary.topHolders)) return { ok: false, why: 'no rug report', retry: true };",
    "  var risks = (summary && summary.risks) || src.risks || [];",
    "  var rugged = src.rugged === true;",
    "  var created = src.creatorTokens || [];",
    "  if (!rugged && created.some) rugged = created.some(function (c) { return c && (c.rugged === true || c.rugged === 1); });",
    "  if (!rugged) rugged = (risks || []).some(function (r) { return r && /creator rugged/i.test((r.name || '') + ' ' + (r.description || '')); });",
    "  if (rugged) return { ok: false, why: 'creator rugged before' };",
    "  var mintAuth = src.mintAuthority != null ? src.mintAuthority : (src.token && src.token.mintAuthority);",
    "  var frzAuth = src.freezeAuthority != null ? src.freezeAuthority : (src.token && src.token.freezeAuthority);",
    "  if (mintAuth) return { ok: false, why: 'mint authority' };",
    "  if (frzAuth) return { ok: false, why: 'freeze authority' };",
    "  var pools = poolAddrs(src), holders = src.topHolders || [], people = [], i, h, top = 0, cluster = 0;",
    "  for (i = 0; i < holders.length; i++) {",
    "    h = holders[i];",
    "    if (!h || pools[h.address] || pools[h.owner]) continue;",
    "    people.push(h);",
    "    if (num(h.pct) > top) top = num(h.pct);",
    "    if (num(h.pct) >= 2 && num(h.pct) <= 3) cluster++;",
    "  }",
    "  if (!people.length) people = holders.slice(0, 10);",
    "  if (!top) { for (i = 0; i < people.length; i++) if (num(people[i].pct) > top) top = num(people[i].pct); }",
    "  if (top > num(S.settings.topHolderPct)) return { ok: false, why: 'top holder ' + top.toFixed(0) + '%' };",
    "  if (cluster >= 3) return { ok: false, why: 'equal wallets' };",
    "  return { ok: true, why: '' };",
    "}",
    "function pollPx() {",
    "  if (!S.on) return;",
    "  var ids = [], i;",
    "  for (i = 0; i < S.watch.length; i++) ids.push(S.watch[i]);",
    "  for (i = 0; i < S.open.length; i++) if (ids.indexOf(S.open[i].mint) < 0) ids.push(S.open[i].mint);",
    "  ids = ids.slice(0, 30);",
    "  if (!ids.length) return;",
    "  fetch('https://api.dexscreener.com/tokens/v1/solana/' + ids.join(',')).then(function (res) {",
    "    return res.ok ? res.json() : [];",
    "  }).then(function (arr) {",
    "    var best = {}, hit = {};",
    "    (arr || []).forEach(function (pair) {",
    "      var mint = pair && pair.baseToken && pair.baseToken.address;",
    "      if (!mint || !(num(pair.priceUsd) > 0)) return;",
    "      var liq = pair.liquidity && num(pair.liquidity.usd);",
    "      if (!best[mint] || liq > best[mint].liq) {",
    "        var m5 = pair.txns && pair.txns.m5 || {};",
    "        var h1 = pair.txns && pair.txns.h1 || {};",
    "        var vol = pair.volume || {};",
    "        var chg = pair.priceChange || {};",
    "        best[mint] = { px: num(pair.priceUsd), liq: liq, mcap: num(pair.marketCap || pair.fdv), buys: num(m5.buys), sells: num(m5.sells), h1Buys: num(h1.buys), volH1: num(vol.h1), chgM5: num(chg.m5), created: num(pair.pairCreatedAt), symbol: pair.baseToken.symbol || '', dex: pair.dexId || '' };",
    "      }",
    "      hit[mint] = 1;",
    "    });",
    "    var missing = ids.filter(function (id) { return !hit[id]; });",
    "    applyQuotes(best);",
    "    if (missing.length) jupFallback(missing.slice(0, 20));",
    "    else { pushEq(''); post(); }",
    "  }).catch(function () {});",
    "}",
    "function jupFallback(ids) {",
    "  fetch('https://api.jup.ag/price/v2?ids=' + ids.join(',')).then(function (res) { return res.ok ? res.json() : null; }).then(function (body) {",
    "    var data = body && body.data || {};",
    "    var best = {};",
    "    ids.forEach(function (id) {",
    "      var row = data[id];",
    "      var px = row && num(row.price);",
    "      if (px > 0) best[id] = { px: px, liq: 0, mcap: 0, buys: 0, sells: 0, created: 0, symbol: '' };",
    "    });",
    "    applyQuotes(best);",
    "    pushEq(''); post();",
    "  }).catch(function () { pushEq(''); post(); });",
    "}",
    "function applyQuotes(best) {",
    "  var now = Date.now(), mint;",
    "  for (mint in best) {",
    "    if (!Object.prototype.hasOwnProperty.call(best, mint)) continue;",
    "    var q = best[mint];",
    "    var row = series[mint] || { symbol: q.symbol || mint.slice(0, 4), bars: [], ready: true };",
    "    if (q.symbol) row.symbol = q.symbol;",
    "    row.buys = q.buys; row.sells = q.sells; row.h1Buys = q.h1Buys; row.volH1 = q.volH1; row.chgM5 = q.chgM5;",
    "    row.liq = q.liq || row.liq; row.mcap = q.mcap || row.mcap; if (q.dex) row.dex = q.dex;",
    "    if (q.created) row.created = q.created;",
    "    ingest(row, q.px, now, q.volH1);",
    "    series[mint] = row;",
    "    var open = null, i;",
    "    for (i = 0; i < S.open.length; i++) if (S.open[i].mint === mint) open = S.open[i];",
    "    if (open) { open.lastPx = q.px; markExit(open, q.px, now); }",
    "    else if (row.ready) maybeEnter(mint, row, q.px, now);",
    "  }",
    "}",
    "function ingest(row, px, now, vol) {",
    "  if (!(px > 0)) return;",
    "  var bucket = Math.floor(now / 60000) * 60000;",
    "  var bars = row.bars || (row.bars = []);",
    "  var last = bars[bars.length - 1];",
    "  var dv = (row.volSeen > 0 && vol > row.volSeen) ? vol - row.volSeen : 0;",
    "  if (!last || last.t !== bucket) bars.push({ t: bucket, o: px, h: px, l: px, c: px, v: dv });",
    "  else { if (px > last.h) last.h = px; if (px < last.l) last.l = px; last.c = px; last.v = (last.v || 0) + dv; }",
    "  if (vol > 0) row.volSeen = vol;",
    "  if (bars.length > 40) bars.splice(0, bars.length - 40);",
    "}",
    "function poolOk(dex) {",
    "  var d = String(dex || '').toLowerCase();",
    "  return d.indexOf('pump') >= 0 || d.indexOf('raydium') >= 0 || d.indexOf('meteora') >= 0;",
    "}",
    "function flowOk(row) {",
    "  var need = num(S.settings.buySell) || 1.3;",
    "  if (!(row.buys > 0)) return false;",
    "  if (row.sells > 0) return row.buys >= need * row.sells;",
    "  return true;",
    "}",
    "function setupOf(row, px) {",
    "  var bars = row.bars || [];",
    "  if (bars.length < 5) return '';",
    "  var closed = bars.slice(0, -1), i;",
    "  var last = closed[closed.length - 1];",
    "  if (!last) return '';",
    "  var avg = 0, n = 0;",
    "  for (i = 0; i < closed.length - 1; i++) { avg += closed[i].v || 0; n++; }",
    "  avg = n ? avg / n : 0;",
    "  var volOk = avg > 0 ? (last.v || 0) >= avg * 2 : row.buys >= 2;",
    "  var base = closed.slice(-6, -1);",
    "  if (base.length >= 3) {",
    "    var hi = base[0].h, lo = base[0].l;",
    "    for (i = 1; i < base.length; i++) { if (base[i].h > hi) hi = base[i].h; if (base[i].l < lo) lo = base[i].l; }",
    "    var tight = lo > 0 && (hi - lo) / lo <= 0.12;",
    "    if (tight && last.c > hi && px >= hi && volOk) return 'breakout';",
    "    var broke = false;",
    "    for (i = 0; i < closed.length; i++) if (closed[i].h > hi * 1.02) broke = true;",
    "    if (tight && broke && px >= hi && px <= hi * 1.06) return 'retest';",
    "  }",
    "  var swing = closed[0].h, priorLow = closed[0].l;",
    "  for (i = 1; i < closed.length - 1; i++) { if (closed[i].h > swing) swing = closed[i].h; if (closed[i].l < priorLow) priorLow = closed[i].l; }",
    "  if (swing > 0) {",
    "    var dd = (swing - last.l) / swing;",
    "    if (dd >= 0.25 && dd <= 0.55 && last.l >= priorLow && last.c > last.o && px >= last.c) return 'pullback';",
    "  }",
    "  if (closed.length >= 4 && row.sells > 0 && row.buys >= row.sells) {",
    "    var sup = closed[closed.length - 4].l;",
    "    if (closed[closed.length - 2].c < sup && last.c > sup && last.c > last.o) return 'reclaim';",
    "  }",
    "  return '';",
    "}",
    "function maybeEnter(mint, row, px, now) {",
    "  var cfg = S.settings, i;",
    "  if (row.dead) return;",
    "  if (S.block && S.block[mint] && S.block[mint] > now) { tally(mint, 're-entry block'); return; }",
    "  if (S.open.length >= num(cfg.maxOpen)) return;",
    "  for (i = 0; i < S.open.length; i++) if (S.open[i].mint === mint) return;",
    "  if (!row.dex) return;",
    "  if (!poolOk(row.dex)) { tally(mint, 'pool'); row.dead = true; return; }",
    "  var sym = String(row.symbol || '').toUpperCase();",
    "  if (!S.names) S.names = {};",
    "  if (sym && String(row.dex || '').toLowerCase().indexOf('meteora') >= 0 && S.names[sym] && S.names[sym] !== mint) { tally(mint, 'meteora copycat'); row.dead = true; return; }",
    "  if (!(row.liq >= num(cfg.minLiq))) { tally(mint, 'liquidity'); return; }",
    "  if (!(row.mcap >= num(cfg.minMcap) && row.mcap <= num(cfg.maxMcap))) { tally(mint, 'mcap'); return; }",
    "  if (row.liq > row.mcap) { tally(mint, 'liq above mcap'); return; }",
    "  if (!row.created) { tally(mint, 'age'); return; }",
    "  var age = (now - row.created) / 60000;",
    "  if (age < num(cfg.minAgeMin) || age > num(cfg.maxAgeMin)) { tally(mint, 'age'); return; }",
    "  if (row.volH1 > 0 && row.liq > 0 && row.volH1 / row.liq > 30 && row.h1Buys < 25) { tally(mint, 'wash'); return; }",
    "  if (!flowOk(row)) return;",
    "  var setup = setupOf(row, px);",
    "  if (!setup) return;",
    "  if (row.chgM5 > 60 && setup !== 'pullback') { tally(mint, 'chase'); return; }",
    "  if (sym && !S.names[sym]) S.names[sym] = mint;",
    "  var usd = S.cash * num(cfg.sizePct) / 100;",
    "  if (!(usd >= 2) || usd > S.cash + 1e-9) { tally(mint, 'cash'); S.last.mom = 'Not enough paper cash'; return; }",
    "  var drag = (num(cfg.slipPct) + num(cfg.feePct)) / 100;",
    "  var fill = px * (1 + drag);",
    "  var qty = usd / fill;",
    "  S.cash = Math.round((S.cash - usd) * 100) / 100;",
    "  S.bought++;",
    "  S.open.push({ mint: mint, symbol: row.symbol || mint.slice(0, 4), setup: setup, signalPx: px, entryPx: fill, qty: qty, qtyLeft: qty, costLeft: usd, opened: now, lastPx: px, high: px, pnl: 0 });",
    "  S.last.mom = setup + ' ' + (row.symbol || mint.slice(0, 4));",
    "  say('Paper ' + (row.symbol || mint.slice(0, 4)) + ' ' + setup + ' $' + usd.toFixed(2));",
    "  watchMint(mint);",
    "  pushEq('buy');",
    "}",
    "function tehranStamp(ts) {",
    "  var d = new Date(ts + 12600000);",
    "  function p(n) { return (n < 10 ? '0' : '') + n; }",
    "  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());",
    "}",
    "function markExit(p, px, now) {",
    "  var cfg = S.settings;",
    "  if (px > p.high) p.high = px;",
    "  var base = p.signalPx > 0 ? p.signalPx : p.entryPx;",
    "  var gain = base > 0 ? px / base - 1 : 0;",
    "  if (gain <= -num(cfg.hardStopPct) / 100) { closeAll(p, px, 'hard stop'); return; }",
    "  if (gain >= num(cfg.tpPct) / 100) { closeAll(p, px, 'tp +' + cfg.tpPct + '%'); return; }",
    "  if ((now - p.opened) / 60000 >= num(cfg.timeStopMin)) closeAll(p, px, 'time stop');",
    "}",
    "function closeAll(p, px, why) {",
    "  if (!(p.qtyLeft > 0) || p.closing) return;",
    "  p.closing = true;",
    "  var cfg = S.settings;",
    "  var drag = (num(cfg.slipPct) + num(cfg.feePct)) / 100;",
    "  var fill = px * (1 - drag);",
    "  var proceeds = p.qtyLeft * fill;",
    "  var pnl = proceeds - p.costLeft;",
    "  var now = Date.now();",
    "  S.cash = Math.round((S.cash + proceeds) * 100) / 100;",
    "  S.realized = Math.round((S.realized + pnl) * 100) / 100;",
    "  S.open = S.open.filter(function (x) { return x !== p; });",
    "  S.exited++;",
    "  if (pnl >= 0) S.wins++;",
    "  if (!S.block) S.block = {};",
    "  S.block[p.mint] = now + 60 * 60000;",
    "  var reason = (p.setup || 'setup') + ' · ' + why;",
    "  var signed = (pnl >= 0 ? '+' : '-') + '$' + Math.abs(pnl).toFixed(2);",
    "  S.last.exit = p.symbol + ' ' + signed + ' · ' + reason;",
    "  S.closed.unshift({ t: now, tehran: tehranStamp(now), symbol: p.symbol, mint: p.mint, entry: p.entryPx, exit: fill, pnl: Math.round(pnl * 100) / 100, setup: p.setup || '', why: why, reason: reason });",
    "  if (S.closed.length > 40) S.closed.pop();",
    "  say('Closed ' + p.symbol + ' ' + signed);",
    "  pushEq(pnl >= 0 ? 'win' : 'loss');",
    "}",
    ""
  ].join('\n');
  var banned = /signAndSend|executeSwap|openTrade|degenBuy|sendTransaction|secretKey|sms:degenledger|sms:vaultSol|degen\\.json/;
  if (banned.test(SRC)) { console.error('fast paper blocked'); return; }

  var FIELDS = [
    ['startUsd', 'Starting bankroll $', '1', 100],
    ['sizePct', 'Size, % of paper cash', '1', 16],
    ['maxOpen', 'Max open paper trades', '1', 2],
    ['slipPct', 'Slippage each side %', '0.1', 2],
    ['feePct', 'Fee each side %', '0.1', 0.5],
    ['pxMs', 'Price poll ms', '500', 3000],
    ['buySell', 'Buys over sells, 5 min', '0.1', 1.3],
    ['minLiq', 'Min liquidity $', '100', 15000],
    ['minMcap', 'Min market cap $', '100', 20000],
    ['maxMcap', 'Max market cap $', '1000', 2500000],
    ['minAgeMin', 'Min age minutes', '1', 5],
    ['maxAgeMin', 'Max age minutes', '1', 360],
    ['topHolderPct', 'Top holder max %', '1', 15],
    ['hardStopPct', 'Hard stop %', '1', 18],
    ['tpPct', 'Take profit %', '1', 30],
    ['timeStopMin', 'Time stop minutes', '1', 60]
  ];
  function defaults() {
    var o = {};
    FIELDS.forEach(function (f) { o[f[0]] = f[3]; });
    return o;
  }
  function cleanSettings(raw) {
    var base = defaults();
    FIELDS.forEach(function (f) { if (raw && isFinite(+raw[f[0]])) base[f[0]] = +raw[f[0]]; });
    return base;
  }
  function fresh() {
    var settings = defaults();
    return {
      on: false, settings: settings, cash: 100, start: 100, realized: 0,
      scanned: 0, dodged: 0, bought: 0, wins: 0, exited: 0,
      open: [], closed: [], equity: [{ t: Date.now(), v: 100, dot: '' }],
      last: { scan: 'Idle', rug: 'Idle', mom: 'Idle', exit: 'Idle' },
      ws: 'off', seen: [], pending: [], watch: [], rej: {}, block: {}, rules: 'hunter'
    };
  }
  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(LS) || 'null');
      if (!raw || typeof raw !== 'object' || raw.rules !== 'hunter') return fresh();
      var base = fresh();
      base.on = false;
      base.settings = cleanSettings(raw.settings);
      ['cash', 'start', 'realized', 'scanned', 'dodged', 'bought', 'wins', 'exited'].forEach(function (k) {
        if (isFinite(+raw[k])) base[k] = +raw[k];
      });
      if (Array.isArray(raw.open)) base.open = raw.open;
      if (Array.isArray(raw.closed)) base.closed = raw.closed;
      if (Array.isArray(raw.equity) && raw.equity.length) base.equity = raw.equity;
      if (raw.last) base.last = raw.last;
      if (Array.isArray(raw.seen)) base.seen = raw.seen;
      if (Array.isArray(raw.pending)) base.pending = raw.pending;
      if (Array.isArray(raw.watch)) base.watch = raw.watch;
      if (raw.rej && typeof raw.rej === 'object') base.rej = raw.rej;
      if (raw.block && typeof raw.block === 'object') base.block = raw.block;
      if (raw.on === true) base._resume = true;
      return base;
    } catch (e) { return fresh(); }
  }
  var state = load();
  var range = '1H';
  var worker = null;
  var booted = false;

  function save() {
    var copy = {};
    ['on', 'settings', 'cash', 'start', 'realized', 'scanned', 'dodged', 'bought', 'wins', 'exited', 'open', 'closed', 'equity', 'last', 'seen', 'pending', 'watch', 'rej', 'block'].forEach(function (k) {
      copy[k] = state[k];
    });
    copy.rules = 'hunter';
    try { localStorage.setItem(LS, JSON.stringify(copy)); } catch (e) {}
  }
  function ensureWorker() {
    if (worker) return;
    var blob = new Blob([SRC], { type: 'text/javascript' });
    worker = new Worker(URL.createObjectURL(blob));
    worker.onerror = function (e) {
      console.error('fast paper', e.message || e);
      var note = document.querySelector('[data-fp-ws]');
      if (note) note.textContent = 'Engine error: ' + (e.message || 'worker');
    };
    worker.onmessage = function (ev) {
      var msg = ev.data || {};
      if (msg.type === 'state' && msg.state) {
        state = msg.state;
        save();
        paint();
      } else if (msg.type === 'toast' && typeof toast === 'function') toast(msg.text, 'info', 4200);
    };
  }
  function boot() {
    if (booted) return;
    booted = true;
    ensureWorker();
    worker.postMessage({ type: 'boot', state: state });
  }
  function money(n, signed) {
    if (!isFinite(+n)) return '—';
    var sign = signed ? (+n > 0 ? '+' : +n < 0 ? '−' : '') : (+n < 0 ? '−' : '');
    return sign + '$' + Math.abs(+n).toFixed(2);
  }
  function paint() {
    var root = document.getElementById('fastPaperRoot');
    if (!root) return;
    if (!root.querySelector('[data-fp]')) root.innerHTML = shell();
    var eq = equityOf(state);
    var pnl = eq - (state.start || 100);
    var pct = (state.start || 100) > 0 ? pnl / state.start * 100 : 0;
    root.querySelector('[data-fp-eq]').textContent = money(eq, false);
    root.querySelector('[data-fp-chips]').innerHTML = '<span class="' + (pnl < 0 ? 'pnl-down' : 'pnl-up') + '">' + money(pnl, true) + ' · ' + (pct >= 0 ? '+' : '−') + Math.abs(pct).toFixed(1) + '%</span><span style="color:var(--muted)">Cash ' + money(state.cash, false) + '</span><span style="color:var(--muted)">Realized ' + money(state.realized, true) + '</span>';
    var wins = state.exited ? Math.round(state.wins / state.exited * 100) : 0;
    var tiles = [
      ['Scanner', state.scanned || 0, state.last && state.last.scan || 'Idle'],
      ['Rug check', state.dodged || 0, state.last && state.last.rug || 'Idle'],
      ['Momentum', state.bought || 0, state.last && state.last.mom || 'Idle'],
      ['Exit', (state.exited || 0) + ' · ' + wins + '%', state.last && state.last.exit || 'Idle']
    ];
    root.querySelector('[data-fp-agents]').innerHTML = tiles.map(function (t) {
      return '<article class="fp-tile"><span>' + t[0] + '</span><b>' + t[1] + '</b><p>' + esc(String(t[2])) + '</p></article>';
    }).join('');
    var sw = root.querySelector('[data-fp-sw]');
    if (sw) sw.className = 'ios-sw' + (state.on ? ' on' : '');
    var ws = root.querySelector('[data-fp-ws]');
    if (ws) ws.textContent = state.on ? ('Socket ' + (state.ws || '…') + ' · scanned ' + (state.scanned || 0)) : 'Off. Nothing is scanned until you turn it on.';
    var open = state.open || [];
    root.querySelector('[data-fp-open]').innerHTML = open.length ? open.map(function (p) {
      var ch = p.entryPx > 0 && p.lastPx > 0 ? (p.lastPx / p.entryPx - 1) * 100 : 0;
      return '<div class="paper-row"><div class="flex items-center gap-2 min-w-0">' + logoMark(p.mint, p.symbol) + '<div class="min-w-0"><b>' + esc(p.symbol) + '</b><div class="bot-sub">' + money(p.costLeft, false) + ' left</div></div></div><div class="ui-pnl ' + (ch < 0 ? 'pnl-down' : 'pnl-up') + '">' + (ch >= 0 ? '+' : '−') + Math.abs(ch).toFixed(1) + '%</div></div>';
    }).join('') : '<p class="empty-note">No open paper trades.</p>';
    var closed = state.closed || [];
    root.querySelector('[data-fp-closes]').innerHTML = closed.length ? closed.slice(0, 8).map(function (c) {
      var why = c.reason || ((c.setup ? c.setup + ' · ' : '') + (c.why || ''));
      return '<div class="paper-row"><div class="flex items-center gap-2 min-w-0">' + logoMark(c.mint, c.symbol) + '<div class="min-w-0"><b>' + esc(c.symbol) + '</b><div class="bot-sub">' + esc(c.tehran || '') + ' · ' + esc(why) + '</div></div></div><div class="ui-pnl ' + (c.pnl < 0 ? 'pnl-down' : 'pnl-up') + '">' + money(c.pnl, true) + '</div></div>';
    }).join('') : '<p class="empty-note">No paper closes yet.</p>';
    var rej = state.rej || {};
    var bits = Object.keys(rej).sort(function (a, b) { return rej[b] - rej[a]; }).slice(0, 6);
    var rejEl = root.querySelector('[data-fp-rej]');
    if (rejEl) rejEl.textContent = bits.length ? bits.map(function (k) { return k + ' ' + rej[k]; }).join(' · ') : 'No rejects yet.';
    root.querySelectorAll('[data-fp-range]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-fp-range') === range); });
    draw(root.querySelector('[data-fp-chart]'));
    if (!root.dataset.bound) {
      root.dataset.bound = '1';
      root.addEventListener('click', onClick);
    }
    if (typeof wantLogos === 'function') {
      var ids = (state.open || []).map(function (p) { return p.mint; }).concat((state.closed || []).map(function (c) { return c.mint; }));
      wantLogos(ids, function () { paint(); });
    }
  }
  function logoMark(mint, symbol) {
    if (typeof logoHtml === 'function') return logoHtml(mint, symbol, 1, 'row', 'paper');
    var ch = esc(String(symbol || '?').slice(0, 1).toUpperCase());
    return '<span class="logo-slot"><span class="mono-logo logo-row logo-tone-paper">' + ch + '</span></span>';
  }
  function equityOf(s) {
    var drag = ((s.settings && +s.settings.slipPct || 2) + (s.settings && +s.settings.feePct || 0.5)) / 100;
    var mtm = 0;
    (s.open || []).forEach(function (p) {
      var px = p.lastPx > 0 ? p.lastPx : p.entryPx;
      mtm += (p.qtyLeft || 0) * px * (1 - drag);
    });
    return (s.cash || 0) + mtm;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function shell() {
    return '<section class="hero-card" data-fp>' +
      '<div class="flex items-center justify-between gap-2"><b class="tone tone-paper">Wild Degen Fast</b><span class="ui-pill tone-paper">PAPER — no real money</span></div>' +
      '<div class="fp-bal" data-fp-eq>$100.00</div>' +
      '<div class="fp-chips" data-fp-chips></div>' +
      '<div class="seg fp-range" style="margin-top:12px"><button type="button" data-fp-range="1H">1H</button><button type="button" data-fp-range="4H">4H</button><button type="button" data-fp-range="12H">12H</button><button type="button" data-fp-range="ALL">ALL</button></div>' +
      '<canvas class="fp-chart" data-fp-chart width="360" height="148"></canvas>' +
      '<div class="fp-agents" data-fp-agents></div>' +
      '<p class="bot-sub" data-fp-ws></p>' +
      '<button type="button" class="fp-toggle" data-fp-toggle><span>Engine</span><span class="ios-sw" data-fp-sw><i></i></span></button>' +
      '<p class="bot-sub">Paper bankroll only. This switch cannot sign or spend the burner.</p>' +
      '<h3 class="tone tone-paper" style="margin-top:14px">Open</h3><div data-fp-open></div>' +
      '<h3 class="tone tone-paper" style="margin-top:12px">Recent closes</h3><div data-fp-closes></div>' +
      '<h3 class="tone tone-paper" style="margin-top:12px">Rejects</h3><p class="bot-sub" data-fp-rej>No rejects yet.</p>' +
      '<div class="flex gap-2" style="margin-top:12px"><button type="button" data-fp-set class="ui-more">Thresholds</button><button type="button" data-fp-csv class="ui-more">CSV</button></div>' +
      '</section>' + sheet();
  }
  function sheet() {
    var fields = FIELDS.map(function (f) {
      return '<label>' + f[1] + '<input data-fp-field="' + f[0] + '" inputmode="decimal" value="' + (state.settings ? state.settings[f[0]] : f[3]) + '"></label>';
    }).join('');
    return '<div id="fpSheet" class="token-sheet" role="dialog" aria-label="Fast paper thresholds"><div class="sheet-grab"></div><div class="flex items-center justify-between"><b>Thresholds</b><button type="button" data-fp-close class="ui-more">Close</button></div>' + fields +
      '<button type="button" data-fp-save class="ui-btn" style="width:100%;min-height:44px;margin-top:14px">Save thresholds</button>' +
      '<button type="button" data-fp-reset class="ui-more">Reset paper bankroll</button></div>';
  }
  function onClick(e) {
    var t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-fp-range')) { range = t.getAttribute('data-fp-range'); paint(); return; }
    if (t.hasAttribute('data-fp-toggle')) { toggle(); return; }
    if (t.hasAttribute('data-fp-set')) { document.getElementById('fpSheet').classList.add('open'); return; }
    if (t.hasAttribute('data-fp-close')) { document.getElementById('fpSheet').classList.remove('open'); return; }
    if (t.hasAttribute('data-fp-save')) { saveSettings(); return; }
    if (t.hasAttribute('data-fp-reset')) { resetBook(); return; }
    if (t.hasAttribute('data-fp-csv')) csv();
  }
  function toggle() {
    var turningOn = !state.on;
    state.on = turningOn;
    if (!booted) boot();
    else worker.postMessage({ type: turningOn ? 'on' : 'off' });
    paint();
    if (typeof toast === 'function') toast(turningOn ? 'Wild Degen Fast is paper-only' : 'Wild Degen Fast off', 'info');
  }
  function saveSettings() {
    var next = {};
    document.querySelectorAll('[data-fp-field]').forEach(function (el) { next[el.getAttribute('data-fp-field')] = el.value; });
    state.settings = cleanSettings(next);
    boot();
    worker.postMessage({ type: 'settings', settings: state.settings });
    document.getElementById('fpSheet').classList.remove('open');
    if (typeof toast === 'function') toast('Paper thresholds saved', 'ok');
  }
  function resetBook() {
    if (!window.confirm('Reset the paper bankroll to the starting amount? Real wallets stay untouched.')) return;
    boot();
    worker.postMessage({ type: 'reset' });
    document.getElementById('fpSheet').classList.remove('open');
  }
  function csv() {
    var lines = ['tehran,symbol,mint,entry,exit,pnl_usd,reason'];
    (state.closed || []).forEach(function (c) {
      lines.push([q(c.tehran), q(c.symbol), c.mint, c.entry, c.exit, c.pnl, q(c.reason || c.why)].join(','));
    });
    (state.open || []).forEach(function (p) {
      lines.push(['', q(p.symbol), p.mint, p.entryPx, '', '', q(p.setup || 'open')].join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wild-degen-fast.csv';
    a.click();
  }
  function q(s) { return '"' + String(s || '').replace(/"/g, '""') + '"'; }
  function draw(canvas) {
    if (!canvas) return;
    var width = canvas.clientWidth || 340;
    var height = 148;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    var now = Date.now();
    var span = range === '1H' ? 3600000 : range === '4H' ? 14400000 : range === '12H' ? 43200000 : 0;
    var pts = (state.equity || []).filter(function (p) { return !span || now - p.t <= span; });
    if (!pts.length) pts = [{ t: now, v: state.start || 100, dot: '' }];
    var min = pts[0].v, max = pts[0].v, i;
    for (i = 1; i < pts.length; i++) { if (pts[i].v < min) min = pts[i].v; if (pts[i].v > max) max = pts[i].v; }
    if (max - min < 0.5) { min -= 0.5; max += 0.5; }
    var pad = 16;
    function x(t) { var a = pts[0].t, b = pts[pts.length - 1].t; return pad + (b === a ? 0.5 : (t - a) / (b - a)) * (width - pad * 2); }
    function y(v) { return pad + (1 - (v - min) / (max - min)) * (height - pad * 2); }
    ctx.beginPath();
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    pts.forEach(function (p, idx) { var px = x(p.t), py = y(p.v); if (idx) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.stroke();
    pts.forEach(function (p) {
      if (!p.dot) return;
      ctx.beginPath();
      ctx.fillStyle = p.dot === 'loss' ? '#B91C1C' : p.dot === 'win' ? '#15803D' : '#64748B';
      ctx.arc(x(p.t), y(p.v), 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  window.SMSFastPaper = { paint: paint };
  if (state._resume) { state.on = true; boot(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
  else paint();
})();
