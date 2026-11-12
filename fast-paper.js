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
    "    open: S.open, closed: S.closed.slice(0, 24), equity: S.equity.slice(-800), last: S.last, ws: S.ws };",
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
    "  S.seen = []; S.pending = []; S.watch = [];",
    "  S.last = { scan: 'Idle', rug: 'Idle', mom: 'Idle', exit: 'Idle' };",
    "  rugQ = []; series = {};",
    "}",
    "function start() {",
    "  connect();",
    "  if (!dexTimer) dexTimer = setInterval(pollDex, 30000);",
    "  if (!pxTimer) pxTimer = setInterval(pollPx, Math.max(3000, num(S.settings.pxMs) || 4000));",
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
    "function onPump(msg) {",
    "  if (!msg) return;",
    "  var mint = msg.mint || msg.tokenAddress;",
    "  if (!mint) return;",
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
    "    S.last.rug = name + ' · ' + verdict.why;",
    "    say('Rug dodged ' + name + ' · ' + verdict.why);",
    "  } else {",
    "    if (row) row.ready = true;",
    "    if (S.watch.indexOf(mint) < 0) S.watch.push(mint);",
    "    if (S.watch.length > 40) S.watch.splice(0, S.watch.length - 40);",
    "    S.last.rug = name + ' passed';",
    "  }",
    "}",
    "function judge(summary, report) {",
    "  var cfg = S.settings;",
    "  var src = report || {};",
    "  if (!summary && !report) return { ok: false, why: 'no rug report', retry: true };",
    "  if (!report && !(summary && summary.topHolders)) return { ok: false, why: 'no rug report', retry: true };",
    "  var risks = (summary && summary.risks) || src.risks || [];",
    "  var score = summary && summary.score != null ? num(summary.score) : num(src.score);",
    "  if (src.rugged === true) return { ok: false, why: 'creator rugged' };",
    "  var created = src.creatorTokens || [];",
    "  if (created.some && created.some(function (c) { return c && (c.rugged === true || c.rugged === 1); })) return { ok: false, why: 'creator rug history' };",
    "  if (score > num(cfg.maxRugScore)) return { ok: false, why: 'risk ' + score };",
    "  var danger = null;",
    "  (risks || []).forEach(function (r) { if (r && (r.level === 'danger' || r.level === 'critical') && !danger) danger = r; });",
    "  if (danger) return { ok: false, why: danger.name || 'danger flag' };",
    "  var mintAuth = src.mintAuthority != null ? src.mintAuthority : (src.token && src.token.mintAuthority);",
    "  var frzAuth = src.freezeAuthority != null ? src.freezeAuthority : (src.token && src.token.freezeAuthority);",
    "  if (mintAuth) return { ok: false, why: 'mint authority' };",
    "  if (frzAuth) return { ok: false, why: 'freeze authority' };",
    "  var holders = src.topHolders || [];",
    "  var top10 = 0, i;",
    "  for (i = 0; i < holders.length && i < 10; i++) top10 += num(holders[i].pct);",
    "  if (holders.length && top10 > num(cfg.top10Pct)) return { ok: false, why: 'top 10 ' + top10.toFixed(0) + '%' };",
    "  var creator = src.creator;",
    "  if (creator) {",
    "    for (i = 0; i < holders.length; i++) {",
    "      var h = holders[i];",
    "      if ((h.address === creator || h.owner === creator) && num(h.pct) > num(cfg.devPct)) return { ok: false, why: 'dev ' + num(h.pct).toFixed(1) + '%' };",
    "    }",
    "  }",
    "  var liq = num(src.totalMarketLiquidity);",
    "  if (liq > 0 && liq < num(cfg.minLiq)) return { ok: false, why: 'liq $' + Math.round(liq) };",
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
    "        var tx = pair.txns && (pair.txns.m5 || pair.txns.h1) || {};",
    "        best[mint] = { px: num(pair.priceUsd), liq: liq, mcap: num(pair.marketCap || pair.fdv), buys: num(tx.buys), sells: num(tx.sells), created: num(pair.pairCreatedAt), symbol: pair.baseToken.symbol || '' };",
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
    "    row.buys = q.buys; row.sells = q.sells; row.liq = q.liq || row.liq; row.mcap = q.mcap || row.mcap;",
    "    if (q.created) row.created = q.created;",
    "    ingest(row, q.px, now);",
    "    series[mint] = row;",
    "    var open = null, i;",
    "    for (i = 0; i < S.open.length; i++) if (S.open[i].mint === mint) open = S.open[i];",
    "    if (open) { open.lastPx = q.px; markExit(open, q.px, now); }",
    "    else if (row.ready) maybeEnter(mint, row, q.px, now);",
    "  }",
    "}",
    "function ingest(row, px, now) {",
    "  if (!(px > 0)) return;",
    "  var bucket = Math.floor(now / 60000) * 60000;",
    "  var bars = row.bars || (row.bars = []);",
    "  var last = bars[bars.length - 1];",
    "  if (!last || last.t !== bucket) bars.push({ t: bucket, o: px, h: px, l: px, c: px });",
    "  else { if (px > last.h) last.h = px; if (px < last.l) last.l = px; last.c = px; }",
    "  if (bars.length > 40) bars.splice(0, bars.length - 40);",
    "}",
    "function flowOk(row) {",
    "  var need = num(S.settings.buySell) || 1.5;",
    "  if (row.sells > 0) return row.buys > need * row.sells;",
    "  return row.buys >= need;",
    "}",
    "function maybeEnter(mint, row, px, now) {",
    "  var cfg = S.settings, i;",
    "  if (S.open.length >= num(cfg.maxOpen)) return;",
    "  for (i = 0; i < S.open.length; i++) if (S.open[i].mint === mint) return;",
    "  if (row.liq && row.liq < num(cfg.minLiq)) return;",
    "  if (row.mcap && (row.mcap < num(cfg.minMcap) || row.mcap > num(cfg.maxMcap))) return;",
    "  if (row.created) {",
    "    var age = (now - row.created) / 60000;",
    "    if (age < num(cfg.minAgeMin) || age > num(cfg.maxAgeMin)) return;",
    "  }",
    "  var bars = row.bars || [];",
    "  var n = Math.max(2, num(cfg.higherCloses) || 3);",
    "  if (bars.length < n + 1) return;",
    "  var closed = bars.slice(0, -1);",
    "  var tail = closed.slice(-n);",
    "  var up = true;",
    "  for (i = 1; i < tail.length; i++) if (!(tail[i].c > tail[i - 1].c)) up = false;",
    "  var level = tail[0].o;",
    "  var breakout = up && px >= level && flowOk(row);",
    "  var reclaim = false;",
    "  if (!breakout && closed.length >= 4 && flowOk(row)) {",
    "    var prior = closed.slice(-4, -1);",
    "    var high = prior[0].h;",
    "    for (i = 1; i < prior.length; i++) if (prior[i].h > high) high = prior[i].h;",
    "    var last = closed[closed.length - 1];",
    "    reclaim = last.l < high * (1 - num(cfg.pullbackPct) / 100) && px > high;",
    "  }",
    "  if (!breakout && !reclaim) return;",
    "  var eq = markValue();",
    "  var usd = eq * num(cfg.sizePct) / 100;",
    "  if (usd > S.cash) usd = S.cash;",
    "  if (!(usd >= 2)) { S.last.mom = 'Not enough paper cash'; return; }",
    "  var drag = (num(cfg.slipPct) + num(cfg.feePct)) / 100;",
    "  var fill = px * (1 + drag);",
    "  var qty = usd / fill;",
    "  S.cash = Math.round((S.cash - usd) * 100) / 100;",
    "  S.bought++;",
    "  S.open.push({ mint: mint, symbol: row.symbol || mint.slice(0, 4), entryPx: fill, qty: qty, qtyLeft: qty, costLeft: usd, opened: now, lastPx: px, high: px, tp1: false, tp2: false, pnl: 0 });",
    "  S.last.mom = 'Paper ' + (row.symbol || mint.slice(0, 4));",
    "  say('Paper ' + (row.symbol || mint.slice(0, 4)) + ' $' + usd.toFixed(2));",
    "  pushEq('buy');",
    "}",
    "function markExit(p, px, now) {",
    "  var cfg = S.settings;",
    "  if (px > p.high) p.high = px;",
    "  var gain = p.entryPx > 0 ? px / p.entryPx - 1 : 0;",
    "  if (gain <= -num(cfg.hardStopPct) / 100) { sellQty(p, p.qtyLeft, px, 'hard stop'); return; }",
    "  if (!p.tp1 && gain >= num(cfg.tp1Pct) / 100) { p.tp1 = true; sellQty(p, p.qty * num(cfg.tp1Sell) / 100, px, 'tp +' + cfg.tp1Pct + '%'); }",
    "  if (p.qtyLeft <= 0) return;",
    "  if (!p.tp2 && gain >= num(cfg.tp2Pct) / 100) { p.tp2 = true; sellQty(p, p.qty * num(cfg.tp2Sell) / 100, px, 'tp +' + cfg.tp2Pct + '%'); }",
    "  if (p.qtyLeft <= 0) return;",
    "  if (p.tp1 && p.high > 0 && px <= p.high * (1 - num(cfg.trailPct) / 100)) { sellQty(p, p.qtyLeft, px, 'trail'); return; }",
    "  if ((now - p.opened) / 60000 >= num(cfg.timeStopMin) && Math.abs(gain * 100) < num(cfg.flatPct)) sellQty(p, p.qtyLeft, px, 'time stop');",
    "}",
    "function sellQty(p, qty, px, why) {",
    "  if (!(p.qtyLeft > 0)) return;",
    "  qty = Math.min(p.qtyLeft, Math.max(0, qty));",
    "  if (!(qty > 0)) return;",
    "  var cfg = S.settings;",
    "  var drag = (num(cfg.slipPct) + num(cfg.feePct)) / 100;",
    "  var fill = px * (1 - drag);",
    "  var frac = qty / p.qtyLeft;",
    "  var cost = p.costLeft * frac;",
    "  var proceeds = qty * fill;",
    "  var pnl = proceeds - cost;",
    "  S.cash = Math.round((S.cash + proceeds) * 100) / 100;",
    "  S.realized = Math.round((S.realized + pnl) * 100) / 100;",
    "  p.pnl = (p.pnl || 0) + pnl;",
    "  p.qtyLeft -= qty;",
    "  p.costLeft -= cost;",
    "  var signed = (pnl >= 0 ? '+' : '-') + '$' + Math.abs(pnl).toFixed(2);",
    "  S.last.exit = p.symbol + ' ' + signed + ' · ' + why;",
    "  say('Closed ' + p.symbol + ' ' + signed);",
    "  if (p.qtyLeft <= p.qty * 0.001) {",
    "    S.open = S.open.filter(function (x) { return x !== p; });",
    "    S.exited++;",
    "    if (p.pnl >= 0) S.wins++;",
    "    S.closed.unshift({ t: Date.now(), symbol: p.symbol, mint: p.mint, pnl: Math.round(p.pnl * 100) / 100, why: why, entry: p.entryPx, exit: fill });",
    "    if (S.closed.length > 40) S.closed.pop();",
    "    pushEq(p.pnl >= 0 ? 'win' : 'loss');",
    "  }",
    "}",
    ""
  ].join('\n');
  var banned = /signAndSend|executeSwap|openTrade|degenBuy|sendTransaction|secretKey|sms:degenledger|sms:vaultSol|degen\\.json/;
  if (banned.test(SRC)) { console.error('fast paper blocked'); return; }

  var FIELDS = [
    ['startUsd', 'Starting bankroll $', '1', 100],
    ['sizePct', 'Size, % of paper equity', '1', 15],
    ['maxOpen', 'Max open paper trades', '1', 4],
    ['slipPct', 'Slippage each side %', '0.1', 1],
    ['feePct', 'Fee each side %', '0.1', 0.3],
    ['pxMs', 'Price poll ms', '500', 4000],
    ['higherCloses', 'Higher 1m closes', '1', 3],
    ['buySell', 'Buys over sells', '0.1', 1.5],
    ['pullbackPct', 'Pullback % before reclaim', '0.5', 4],
    ['minLiq', 'Min liquidity $', '100', 8000],
    ['minMcap', 'Min market cap $', '100', 6000],
    ['maxMcap', 'Max market cap $', '1000', 2500000],
    ['minAgeMin', 'Min age minutes', '1', 1],
    ['maxAgeMin', 'Max age minutes', '1', 240],
    ['top10Pct', 'Top 10 holders max %', '1', 15],
    ['devPct', 'Dev wallet max %', '1', 10],
    ['maxRugScore', 'Max RugCheck score', '1', 5000],
    ['hardStopPct', 'Hard stop %', '1', 18],
    ['tp1Pct', 'First target %', '1', 30],
    ['tp1Sell', 'Sell % at first target', '1', 50],
    ['tp2Pct', 'Second target %', '1', 60],
    ['tp2Sell', 'Sell % of original at second', '1', 25],
    ['trailPct', 'Trail the rest %', '1', 15],
    ['timeStopMin', 'Time stop minutes', '1', 10],
    ['flatPct', 'Flat if move under %', '1', 5]
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
      ws: 'off', seen: [], pending: [], watch: []
    };
  }
  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(LS) || 'null');
      if (!raw || typeof raw !== 'object') return fresh();
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
    ['on', 'settings', 'cash', 'start', 'realized', 'scanned', 'dodged', 'bought', 'wins', 'exited', 'open', 'closed', 'equity', 'last', 'seen', 'pending', 'watch'].forEach(function (k) {
      copy[k] = state[k];
    });
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
      return '<div class="paper-row"><div class="min-w-0"><b>' + esc(p.symbol) + '</b><div class="bot-sub">' + money(p.costLeft, false) + ' left</div></div><div class="ui-pnl ' + (ch < 0 ? 'pnl-down' : 'pnl-up') + '">' + (ch >= 0 ? '+' : '−') + Math.abs(ch).toFixed(1) + '%</div></div>';
    }).join('') : '<p class="empty-note">No open paper trades.</p>';
    var closed = state.closed || [];
    root.querySelector('[data-fp-closes]').innerHTML = closed.length ? closed.slice(0, 8).map(function (c) {
      return '<div class="paper-row"><div class="min-w-0"><b>' + esc(c.symbol) + '</b><div class="bot-sub">' + esc(c.why || '') + '</div></div><div class="ui-pnl ' + (c.pnl < 0 ? 'pnl-down' : 'pnl-up') + '">' + money(c.pnl, true) + '</div></div>';
    }).join('') : '<p class="empty-note">No paper closes yet.</p>';
    root.querySelectorAll('[data-fp-range]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-fp-range') === range); });
    draw(root.querySelector('[data-fp-chart]'));
    if (!root.dataset.bound) {
      root.dataset.bound = '1';
      root.addEventListener('click', onClick);
    }
  }
  function equityOf(s) {
    var drag = ((s.settings && +s.settings.slipPct || 1) + (s.settings && +s.settings.feePct || 0.3)) / 100;
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
    var lines = ['time,side,symbol,mint,pnl_usd,reason'];
    (state.closed || []).forEach(function (c) {
      lines.push([new Date(c.t).toISOString(), 'sell', q(c.symbol), c.mint, c.pnl, q(c.why)].join(','));
    });
    (state.open || []).forEach(function (p) {
      lines.push([new Date(p.opened).toISOString(), 'buy', q(p.symbol), p.mint, '', 'open'].join(','));
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
