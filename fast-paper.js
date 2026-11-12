/* Wild Degen Fast — paper only.
   Hunter Fast and Wild Fast share one feed inside a Worker. The worker is
   created with no page functions in its scope, so it cannot reach the signer,
   a swap, the burner, the vault, or the real Degen pot.
   The only storage key this file writes is sms:fastpaper.
   Wild (agent) is a read-only view of the box paper file. */
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
    "function book(id) { return S && S.books && S.books[id]; }",
    "function eachBook(fn) {",
    "  var ids = ['hunter', 'wild'], i;",
    "  for (i = 0; i < ids.length; i++) { var b = book(ids[i]); if (b) { b.id = ids[i]; fn(b, ids[i]); } }",
    "}",
    "function snap() {",
    "  var books = {};",
    "  eachBook(function (b, id) {",
    "    books[id] = { id: id, settings: b.settings, cash: b.cash, start: b.start, realized: b.realized,",
    "      bought: b.bought, wins: b.wins, exited: b.exited, open: b.open, closed: (b.closed || []).slice(0, 24),",
    "      equity: (b.equity || []).slice(-800), rej: b.rej || {}, block: b.block || {}, names: b.names || {},",
    "      last: b.last || { mom: 'Idle', exit: 'Idle' } };",
    "  });",
    "  return { on: S.on, ws: S.ws, scanned: S.scanned, dodged: S.dodged, books: books,",
    "    seen: S.seen, pending: S.pending, watch: S.watch, last: S.last };",
    "}",
    "function markValue(b) {",
    "  var drag = (num(b.settings.slipPct) + num(b.settings.feePct)) / 100;",
    "  var mtm = 0, i;",
    "  for (i = 0; i < b.open.length; i++) {",
    "    var p = b.open[i];",
    "    var px = p.lastPx > 0 ? p.lastPx : p.entryPx;",
    "    mtm += p.qtyLeft * px * (1 - drag);",
    "  }",
    "  return b.cash + mtm;",
    "}",
    "function pushEq(b, dot) {",
    "  var v = Math.round(markValue(b) * 100) / 100;",
    "  var now = Date.now();",
    "  if (!b.equity) b.equity = [];",
    "  var last = b.equity[b.equity.length - 1];",
    "  if (!dot && last && now - last.t < 12000) { last.v = v; return; }",
    "  b.equity.push({ t: now, v: v, dot: dot || '' });",
    "  if (b.equity.length > 800) b.equity.splice(0, b.equity.length - 800);",
    "}",
    "function pushBoth() { eachBook(function (b) { pushEq(b, ''); }); }",
    "onmessage = function (ev) {",
    "  var m = ev.data || {};",
    "  if (m.type === 'boot') { S = m.state; eachBook(function () {}); rugQ = (S.pending || []).slice(); if (S.on) start(); post(); }",
    "  else if (m.type === 'on') { S.on = true; start(); post(); }",
    "  else if (m.type === 'off') { S.on = false; stop(); post(); }",
    "  else if (m.type === 'settings') { var sb = book(m.book || 'hunter'); if (sb) sb.settings = m.settings; post(); }",
    "  else if (m.type === 'reset') { resetBook(m.book || 'hunter'); post(); }",
    "};",
    "function resetBook(id) {",
    "  var b = book(id);",
    "  if (!b) return;",
    "  var start = num(b.settings && b.settings.startUsd) || 100;",
    "  b.cash = start; b.start = start; b.realized = 0;",
    "  b.open = []; b.closed = []; b.equity = [{ t: Date.now(), v: start, dot: '' }];",
    "  b.bought = 0; b.wins = 0; b.exited = 0;",
    "  b.rej = {}; b.rejOnce = {}; b.block = {}; b.names = {};",
    "  b.last = { mom: 'Idle', exit: 'Idle' };",
    "}",
    "function pollMs() {",
    "  var ms = 3000;",
    "  eachBook(function (b) { var n = num(b.settings && b.settings.pxMs); if (n >= 2000 && n < ms) ms = n; });",
    "  return ms;",
    "}",
    "function start() {",
    "  connect();",
    "  if (!dexTimer) dexTimer = setInterval(pollDex, 30000);",
    "  if (!pxTimer) pxTimer = setInterval(pollPx, pollMs());",
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
    "    eachBook(function (b) { var oi; for (oi = 0; oi < b.open.length; oi++) watchMint(b.open[oi].mint); });",
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
    "  var now = Date.now(), touched = false;",
    "  if (num(msg.solAmount) > 0 && num(msg.tokenAmount) > 0 && solPx > 0) {",
    "    var live = (num(msg.solAmount) / num(msg.tokenAmount)) * solPx;",
    "    eachBook(function (b) {",
    "      var held = null, hi;",
    "      for (hi = 0; hi < b.open.length; hi++) if (b.open[hi].mint === mint) held = b.open[hi];",
    "      if (!held || !(live > 0) || !(held.lastPx > 0)) return;",
    "      if (live < held.lastPx * 3 && live > held.lastPx / 3) { held.prevPx = held.lastPx; held.lastPx = live; markExit(b, held, live, now); touched = true; }",
    "    });",
    "  }",
    "  if (touched) post();",
    "  if (S.seen.indexOf(mint) >= 0) return;",
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
    "  series[mint] = { symbol: String(symbol || mint.slice(0, 4)).slice(0, 16), bars: [], ready: false, buys: 0, sells: 0, liq: 0, mcap: 0, created: 0, highPx: 0 };",
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
    "      else finishRug(mint, { ok: false, why: 'no rug report', top: 0, cluster: 0 });",
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
    "  if (row) { row.top = verdict.top || 0; row.cluster = verdict.cluster || 0; }",
    "  if (!verdict.ok) {",
    "    S.dodged++;",
    "    eachBook(function (b) { tally(b, mint, verdict.why); });",
    "    S.last.rug = name + ' · ' + verdict.why;",
    "    if (row) row.dead = true;",
    "    say('Rug dodged ' + name + ' · ' + verdict.why);",
    "  } else {",
    "    if (row) row.ready = true;",
    "    if (S.watch.indexOf(mint) < 0) S.watch.push(mint);",
    "    if (S.watch.length > 40) S.watch.splice(0, S.watch.length - 40);",
    "    S.last.rug = name + ' passed';",
    "  }",
    "}",
    "function tally(b, mint, why) {",
    "  if (!b || !why) return;",
    "  if (!b.rejOnce) b.rejOnce = {};",
    "  var key = mint + '|' + why;",
    "  if (b.rejOnce[key]) return;",
    "  b.rejOnce[key] = 1;",
    "  if (!b.rej) b.rej = {};",
    "  b.rej[why] = (b.rej[why] || 0) + 1;",
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
    "  if (!summary && !report) return { ok: false, why: 'no rug report', retry: true, top: 0, cluster: 0 };",
    "  if (!report && !(summary && summary.topHolders)) return { ok: false, why: 'no rug report', retry: true, top: 0, cluster: 0 };",
    "  var risks = (summary && summary.risks) || src.risks || [];",
    "  var rugged = src.rugged === true;",
    "  var created = src.creatorTokens || [];",
    "  if (!rugged && created.some) rugged = created.some(function (c) { return c && (c.rugged === true || c.rugged === 1); });",
    "  if (!rugged) rugged = (risks || []).some(function (r) { return r && /creator rugged/i.test((r.name || '') + ' ' + (r.description || '')); });",
    "  if (rugged) return { ok: false, why: 'creator rugged before', top: 0, cluster: 0 };",
    "  var mintAuth = src.mintAuthority != null ? src.mintAuthority : (src.token && src.token.mintAuthority);",
    "  var frzAuth = src.freezeAuthority != null ? src.freezeAuthority : (src.token && src.token.freezeAuthority);",
    "  if (mintAuth) return { ok: false, why: 'mint authority', top: 0, cluster: 0 };",
    "  if (frzAuth) return { ok: false, why: 'freeze authority', top: 0, cluster: 0 };",
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
    "  return { ok: true, why: '', top: top, cluster: cluster };",
    "}",
    "function pollPx() {",
    "  if (!S.on) return;",
    "  var ids = [], i;",
    "  for (i = 0; i < S.watch.length; i++) ids.push(S.watch[i]);",
    "  eachBook(function (b) {",
    "    var j; for (j = 0; j < b.open.length; j++) if (ids.indexOf(b.open[j].mint) < 0) ids.push(b.open[j].mint);",
    "  });",
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
    "        best[mint] = { px: num(pair.priceUsd), liq: liq, mcap: num(pair.marketCap || pair.fdv), buys: num(m5.buys), sells: num(m5.sells), h1Buys: num(h1.buys), volH1: num(vol.h1), volM5: num(vol.m5), chgM5: num(chg.m5), created: num(pair.pairCreatedAt), symbol: pair.baseToken.symbol || '', dex: pair.dexId || '' };",
    "      }",
    "      hit[mint] = 1;",
    "    });",
    "    var missing = ids.filter(function (id) { return !hit[id]; });",
    "    applyQuotes(best);",
    "    if (missing.length) jupFallback(missing.slice(0, 20));",
    "    else { pushBoth(); post(); }",
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
    "    pushBoth(); post();",
    "  }).catch(function () { pushBoth(); post(); });",
    "}",
    "function applyQuotes(best) {",
    "  var now = Date.now(), mint;",
    "  for (mint in best) {",
    "    if (!Object.prototype.hasOwnProperty.call(best, mint)) continue;",
    "    var q = best[mint];",
    "    var row = series[mint] || { symbol: q.symbol || mint.slice(0, 4), bars: [], ready: true, highPx: 0 };",
    "    if (q.symbol) row.symbol = q.symbol;",
    "    row.buys = q.buys; row.sells = q.sells; row.h1Buys = q.h1Buys; row.volH1 = q.volH1; row.volM5 = q.volM5; row.chgM5 = q.chgM5;",
    "    row.liq = q.liq || row.liq; row.mcap = q.mcap || row.mcap; if (q.dex) row.dex = q.dex;",
    "    if (q.created) row.created = q.created;",
    "    if (q.px > (row.highPx || 0)) row.highPx = q.px;",
    "    ingest(row, q.px, now, q.volH1);",
    "    series[mint] = row;",
    "    eachBook(function (b) {",
    "      var open = null, i;",
    "      for (i = 0; i < b.open.length; i++) if (b.open[i].mint === mint) open = b.open[i];",
    "      if (open) {",
    "        var prev = open.lastPx > 0 ? open.lastPx : open.entryPx;",
    "        if (q.liq > 0) open.liq = q.liq;",
    "        if (!(prev > 0) || q.px <= prev * 4) { open.prevPx = prev; open.lastPx = q.px; markExit(b, open, q.px, now); }",
    "      } else if (row.ready && !row.dead) maybeEnter(b, mint, row, q.px, now);",
    "    });",
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
    "function copycat(b, row, mint) {",
    "  var sym = String(row.symbol || '').toUpperCase();",
    "  if (!b.names) b.names = {};",
    "  if (sym && String(row.dex || '').toLowerCase().indexOf('meteora') >= 0 && b.names[sym] && b.names[sym] !== mint) { tally(b, mint, 'meteora copycat'); return true; }",
    "  return false;",
    "}",
    "function flowOk(b, row) {",
    "  var need = num(b.settings.buySell) || 1.3;",
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
    "function hunterSetup(b, mint, row, px, now) {",
    "  var cfg = b.settings;",
    "  if (copycat(b, row, mint)) return '';",
    "  if (!(row.liq >= num(cfg.minLiq))) { tally(b, mint, 'liquidity'); return ''; }",
    "  if (!(row.mcap >= num(cfg.minMcap) && row.mcap <= num(cfg.maxMcap))) { tally(b, mint, 'mcap'); return ''; }",
    "  if (row.liq > row.mcap) { tally(b, mint, 'liq above mcap'); return ''; }",
    "  if (!row.created) { tally(b, mint, 'age'); return ''; }",
    "  var age = (now - row.created) / 60000;",
    "  if (age < num(cfg.minAgeMin) || age > num(cfg.maxAgeMin)) { tally(b, mint, 'age'); return ''; }",
    "  if (row.volH1 > 0 && row.liq > 0 && row.volH1 / row.liq > 30 && row.h1Buys < 25) { tally(b, mint, 'wash'); return ''; }",
    "  if (row.top > num(cfg.topHolderPct)) { tally(b, mint, 'top holder'); return ''; }",
    "  if (row.cluster >= 3) { tally(b, mint, 'equal wallets'); return ''; }",
    "  if (!flowOk(b, row)) return '';",
    "  var setup = setupOf(row, px);",
    "  if (!setup) return '';",
    "  if (row.chgM5 > 60 && setup !== 'pullback') { tally(b, mint, 'chase'); return ''; }",
    "  var sym = String(row.symbol || '').toUpperCase();",
    "  if (sym && !b.names[sym]) b.names[sym] = mint;",
    "  return setup;",
    "}",
    "function wildAccel(row) {",
    "  if (!(row.buys >= 8)) return false;",
    "  var buyPace = row.h1Buys > 0 ? row.h1Buys / 12 : 0;",
    "  if (buyPace > 0 && row.buys < buyPace * 1.8) return false;",
    "  if (!(row.volM5 >= 1500)) return false;",
    "  var volPace = row.volH1 > 0 ? row.volH1 / 12 : 0;",
    "  if (volPace > 0 && row.volM5 < volPace * 1.8) return false;",
    "  return true;",
    "}",
    "function wildSetup(b, mint, row, px, now) {",
    "  var cfg = b.settings;",
    "  if (copycat(b, row, mint)) return '';",
    "  if (!(row.liq >= num(cfg.minLiq))) { tally(b, mint, 'liquidity'); return ''; }",
    "  if (!(row.mcap > 0) || row.liq > row.mcap) { tally(b, mint, 'liq above mcap'); return ''; }",
    "  if (!row.created) { tally(b, mint, 'age'); return ''; }",
    "  var age = (now - row.created) / 60000;",
    "  if (age < num(cfg.minAgeMin) || age >= num(cfg.maxAgeMin)) { tally(b, mint, 'age'); return ''; }",
    "  if (row.top > num(cfg.topHolderPct)) { tally(b, mint, 'top holder'); return ''; }",
    "  if (!(row.sells > 0)) { tally(b, mint, 'honeypot'); return ''; }",
    "  var ratio = row.buys / row.sells;",
    "  if (ratio > 0.85 && ratio < 1.18 && row.volH1 > 0 && row.liq > 0 && row.volH1 / row.liq > 8) { tally(b, mint, 'wash'); return ''; }",
    "  if (row.highPx > 0 && px < row.highPx * 0.65 && row.sells >= row.buys) { tally(b, mint, 'dumping'); return ''; }",
    "  if (!wildAccel(row)) { tally(b, mint, 'pace'); return ''; }",
    "  var buysDom = row.buys >= row.sells;",
    "  if (!buysDom) { tally(b, mint, 'sells dominate'); return ''; }",
    "  var bars = row.bars || [], setup = 'chase', i;",
    "  if (bars.length >= 4) {",
    "    var closed = bars.slice(0, -1), base = closed.slice(-5), top = base.length ? base[0].h : px;",
    "    for (i = 1; i < base.length; i++) if (base[i].h > top) top = base[i].h;",
    "    if (px >= top) setup = 'breakout';",
    "    else {",
    "      var hi = row.highPx || top, dd = hi > 0 ? (hi - px) / hi : 0;",
    "      if (dd >= 0.08 && dd <= 0.35) setup = 'dip';",
    "    }",
    "  }",
    "  var sym = String(row.symbol || '').toUpperCase();",
    "  if (sym && !b.names[sym]) b.names[sym] = mint;",
    "  return setup;",
    "}",
    "function maybeEnter(b, mint, row, px, now) {",
    "  var cfg = b.settings, i;",
    "  if (row.dead || !row.dex) return;",
    "  if (b.block && b.block[mint] && b.block[mint] > now) { tally(b, mint, 're-entry block'); return; }",
    "  if (b.open.length >= num(cfg.maxOpen)) return;",
    "  for (i = 0; i < b.open.length; i++) if (b.open[i].mint === mint) return;",
    "  if (!poolOk(row.dex)) { tally(b, mint, 'pool'); row.dead = true; return; }",
    "  var setup = b.id === 'wild' ? wildSetup(b, mint, row, px, now) : hunterSetup(b, mint, row, px, now);",
    "  if (!setup) return;",
    "  var usd = b.cash * num(cfg.sizePct) / 100;",
    "  var floor = b.id === 'wild' ? 5 : 2;",
    "  if (!(usd >= floor) || usd > b.cash + 1e-9) { tally(b, mint, 'cash'); b.last.mom = 'Not enough paper cash'; return; }",
    "  var drag = (num(cfg.slipPct) + num(cfg.feePct)) / 100;",
    "  var fill = px * (1 + drag);",
    "  var qty = usd / fill;",
    "  b.cash = Math.round((b.cash - usd) * 100) / 100;",
    "  b.bought++;",
    "  b.open.push({ mint: mint, symbol: row.symbol || mint.slice(0, 4), setup: setup, signalPx: px, entryPx: fill, qty: qty, qtyLeft: qty, costLeft: usd, opened: now, lastPx: px, prevPx: px, high: px, entryLiq: row.liq || 0, liq: row.liq || 0, pnl: 0 });",
    "  b.last.mom = setup + ' ' + (row.symbol || mint.slice(0, 4));",
    "  say((b.id === 'wild' ? 'Wild ' : 'Hunter ') + (row.symbol || mint.slice(0, 4)) + ' ' + setup + ' $' + usd.toFixed(2));",
    "  watchMint(mint);",
    "  pushEq(b, 'buy');",
    "}",
    "function tehranStamp(ts) {",
    "  var d = new Date(ts + 12600000);",
    "  function p(n) { return (n < 10 ? '0' : '') + n; }",
    "  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());",
    "}",
    "function lossCap(b, cost) {",
    "  var cfg = b.settings || {};",
    "  var stop = num(cfg.hardStopPct) / 100;",
    "  var costs = (num(cfg.slipPct) + num(cfg.feePct)) / 100 * 2;",
    "  return cost * (stop + costs);",
    "}",
    "function markExit(b, p, px, now) {",
    "  var cfg = b.settings;",
    "  if (px > p.high) p.high = px;",
    "  if (b.id === 'wild' && p.entryLiq > 0 && p.liq > 0 && p.liq < p.entryLiq * 0.5) { closeAll(b, p, px, 'liq pull'); return; }",
    "  var base = p.signalPx > 0 ? p.signalPx : p.entryPx;",
    "  var gain = base > 0 ? px / base - 1 : 0;",
    "  var entry = p.entryPx > 0 ? p.entryPx : base;",
    "  if (entry > 0 && px <= entry * (1 - num(cfg.hardStopPct) / 100)) { closeAll(b, p, px, 'hard_stop'); return; }",
    "  if (gain >= num(cfg.tpPct) / 100) { closeAll(b, p, px, 'tp +' + cfg.tpPct + '%'); return; }",
    "  if ((now - p.opened) / 60000 >= num(cfg.timeStopMin)) closeAll(b, p, px, 'time stop');",
    "}",
    "function closeAll(b, p, px, why) {",
    "  if (!(p.qtyLeft > 0) || p.closing) return;",
    "  p.closing = true;",
    "  var cfg = b.settings;",
    "  var drag = (num(cfg.slipPct) + num(cfg.feePct)) / 100;",
    "  var fill = px * (1 - drag);",
    "  var tag = why;",
    "  if (why === 'hard_stop' && p.qtyLeft > 0) {",
    "    var rawPnl = p.qtyLeft * fill - p.costLeft;",
    "    var cap = lossCap(b, p.costLeft);",
    "    if (rawPnl < -cap - 0.009) {",
    "      var prev = p.prevPx > 0 ? p.prevPx : p.entryPx;",
    "      var realGap = px > 0 && prev > 0 && px >= prev / 4;",
    "      if (realGap) tag = 'hard_stop · gap';",
    "      else fill = (p.costLeft - cap) / p.qtyLeft;",
    "    }",
    "  }",
    "  if (!(fill > 0)) fill = 0;",
    "  var proceeds = p.qtyLeft * fill;",
    "  var pnl = proceeds - p.costLeft;",
    "  var now = Date.now();",
    "  b.cash = Math.round((b.cash + proceeds) * 100) / 100;",
    "  b.realized = Math.round((b.realized + pnl) * 100) / 100;",
    "  b.open = b.open.filter(function (x) { return x !== p; });",
    "  b.exited++;",
    "  if (pnl >= 0) b.wins++;",
    "  if (!b.block) b.block = {};",
    "  b.block[p.mint] = now + 60 * 60000;",
    "  var reason = (p.setup || 'setup') + ' · ' + tag;",
    "  var signed = (pnl >= 0 ? '+' : '-') + '$' + Math.abs(pnl).toFixed(2);",
    "  b.last.exit = p.symbol + ' ' + signed + ' · ' + reason;",
    "  b.closed.unshift({ t: now, tehran: tehranStamp(now), symbol: p.symbol, mint: p.mint, entry: p.entryPx, exit: fill, pnl: Math.round(pnl * 100) / 100, setup: p.setup || '', why: tag, reason: reason });",
    "  if (b.closed.length > 40) b.closed.pop();",
    "  say((b.id === 'wild' ? 'Wild closed ' : 'Hunter closed ') + p.symbol + ' ' + signed);",
    "  pushEq(b, pnl >= 0 ? 'win' : 'loss');",
    "}",
    ""
  ].join('\n');
  var banned = /signAndSend|executeSwap|openTrade|degenBuy|sendTransaction|secretKey|sms:degenledger|sms:vaultSol|degen\\.json/;
  if (banned.test(SRC)) { console.error('fast paper blocked'); return; }

  var FIELD_LIST = [
    ['startUsd', 'Starting bankroll $', '1'],
    ['sizePct', 'Size, % of cash', '1'],
    ['maxOpen', 'Max open', '1'],
    ['slipPct', 'Slippage each side %', '0.1'],
    ['feePct', 'Fee each side %', '0.1'],
    ['pxMs', 'Price poll ms', '500'],
    ['buySell', 'Buys over sells, 5 min', '0.1'],
    ['minLiq', 'Min liquidity $', '100'],
    ['minMcap', 'Min market cap $', '100'],
    ['maxMcap', 'Max market cap $', '1000'],
    ['minAgeMin', 'Min age minutes', '1'],
    ['maxAgeMin', 'Max age minutes', '1'],
    ['topHolderPct', 'Top holder max %', '1'],
    ['hardStopPct', 'Hard stop %', '1'],
    ['tpPct', 'Take profit %', '1'],
    ['timeStopMin', 'Time stop minutes', '1']
  ];
  var HUNTER_DEF = {
    startUsd: 100, sizePct: 16, maxOpen: 2, slipPct: 2, feePct: 0.5, pxMs: 3000, buySell: 1.3,
    minLiq: 15000, minMcap: 20000, maxMcap: 2500000, minAgeMin: 5, maxAgeMin: 360,
    topHolderPct: 15, hardStopPct: 6, tpPct: 30, timeStopMin: 60
  };
  var WILD_DEF = {
    startUsd: 100, sizePct: 20, maxOpen: 4, slipPct: 2, feePct: 0.5, pxMs: 3000, buySell: 1.3,
    minLiq: 10000, minMcap: 0, maxMcap: 100000000000, minAgeMin: 0, maxAgeMin: 720,
    topHolderPct: 20, hardStopPct: 6, tpPct: 30, timeStopMin: 60
  };
  function defs(id) { return id === 'wild' ? WILD_DEF : HUNTER_DEF; }
  function clean(raw, id) {
    var base = Object.assign({}, defs(id));
    FIELD_LIST.forEach(function (f) { if (raw && isFinite(+raw[f[0]])) base[f[0]] = +raw[f[0]]; });
    if (id === 'hunter' && base.hardStopPct === 18) base.hardStopPct = 6;
    return base;
  }
  function blank(id) {
    var settings = clean(null, id);
    var start = settings.startUsd || 100;
    return {
      id: id, settings: settings, cash: start, start: start, realized: 0,
      bought: 0, wins: 0, exited: 0, open: [], closed: [],
      equity: [{ t: Date.now(), v: start, dot: '' }],
      rej: {}, block: {}, names: {}, last: { mom: 'Idle', exit: 'Idle' }
    };
  }
  function adopt(raw, id) {
    var b = blank(id);
    if (!raw || typeof raw !== 'object') return b;
    b.settings = clean(raw.settings, id);
    ['cash', 'start', 'realized', 'bought', 'wins', 'exited'].forEach(function (k) {
      if (isFinite(+raw[k])) b[k] = +raw[k];
    });
    if (Array.isArray(raw.open)) b.open = raw.open;
    if (Array.isArray(raw.closed)) b.closed = raw.closed;
    if (Array.isArray(raw.equity) && raw.equity.length) b.equity = raw.equity;
    if (raw.rej && typeof raw.rej === 'object') b.rej = raw.rej;
    if (raw.block && typeof raw.block === 'object') b.block = raw.block;
    if (raw.names && typeof raw.names === 'object') b.names = raw.names;
    if (raw.last && (raw.last.mom || raw.last.exit)) b.last = { mom: raw.last.mom || 'Idle', exit: raw.last.exit || 'Idle' };
    b.id = id;
    return b;
  }
  function load() {
    var state = {
      on: false, ws: 'off', scanned: 0, dodged: 0,
      seen: [], pending: [], watch: [],
      last: { scan: 'Idle', rug: 'Idle' },
      books: { hunter: blank('hunter'), wild: blank('wild') }
    };
    try {
      var raw = JSON.parse(localStorage.getItem(LS) || 'null');
      if (!raw || typeof raw !== 'object') return state;
      if (raw.view === 'hunter' || raw.view === 'wild' || raw.view === 'agent') state.view = raw.view;
      if (raw.books && raw.books.hunter) {
        state.books.hunter = adopt(raw.books.hunter, 'hunter');
        state.books.wild = adopt(raw.books.wild, 'wild');
      } else if (raw.rules === 'hunter' || raw.open || isFinite(+raw.cash)) {
        state.books.hunter = adopt(raw, 'hunter');
      }
      if (isFinite(+raw.scanned)) state.scanned = +raw.scanned;
      if (isFinite(+raw.dodged)) state.dodged = +raw.dodged;
      if (Array.isArray(raw.seen)) state.seen = raw.seen;
      if (Array.isArray(raw.pending)) state.pending = raw.pending;
      if (Array.isArray(raw.watch)) state.watch = raw.watch;
      if (raw.last && (raw.last.scan || raw.last.rug)) state.last = { scan: raw.last.scan || 'Idle', rug: raw.last.rug || 'Idle' };
      if (raw.on === true) state._resume = true;
    } catch (e) { /* fresh books */ }
    return state;
  }
  var state = load();
  var view = state.view || 'hunter';
  var range = '1H';
  var worker = null;
  var booted = false;
  var agentTimer = 0;

  function save() {
    var copy = {
      on: state.on, ws: state.ws, scanned: state.scanned, dodged: state.dodged,
      seen: state.seen, pending: state.pending, watch: state.watch, last: state.last,
      books: state.books, view: view, rules: 'pair'
    };
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
        var keep = view;
        state = msg.state;
        view = keep;
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
  function pctText(n) {
    if (!isFinite(+n)) return '—';
    return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(1) + '%';
  }
  function equityOf(b) {
    if (!b) return 0;
    var drag = ((b.settings && +b.settings.slipPct) || 2) + ((b.settings && +b.settings.feePct) || 0.5);
    drag = drag / 100;
    var mtm = 0;
    (b.open || []).forEach(function (p) {
      var px = p.lastPx > 0 ? p.lastPx : p.entryPx;
      mtm += (p.qtyLeft || 0) * px * (1 - drag);
    });
    return (b.cash || 0) + mtm;
  }
  function wl(b) {
    var wins = b && b.wins || 0;
    var losses = b && b.exited ? Math.max(0, b.exited - wins) : 0;
    return wins + '/' + losses;
  }
  function agentDoc() {
    var box = window.SMSPaper;
    return box && box.doc && typeof box.doc === 'object' ? box.doc : null;
  }
  function agentModel() {
    var doc = agentDoc();
    if (!doc) return null;
    var start = +doc.start_usd || 100;
    var closed = Array.isArray(doc.closed) ? doc.closed : [];
    var open = Array.isArray(doc.open) ? doc.open : [];
    var wins = 0, losses = 0;
    closed.forEach(function (c) { if (+c.pnl_usd >= 0) wins++; else losses++; });
    var pts = [];
    var rows = closed.slice().reverse();
    var v = start;
    var t0 = rows.length && Date.parse(rows[0].closed_tehran);
    pts.push({ t: (t0 || Date.now()) - 60000, v: start, dot: '' });
    rows.forEach(function (c) {
      v = Math.round((v + (+c.pnl_usd || 0)) * 100) / 100;
      var t = Date.parse(c.closed_tehran);
      pts.push({ t: t || Date.now(), v: v, dot: (+c.pnl_usd || 0) < 0 ? 'loss' : 'win' });
    });
    if (isFinite(+doc.equity_usd)) pts.push({ t: Date.now(), v: +doc.equity_usd, dot: '' });
    return {
      id: 'agent', start: start, cash: +doc.cash_usd, realized: +doc.realized_pnl_usd,
      equity: isFinite(+doc.equity_usd) ? +doc.equity_usd : v,
      wins: wins, losses: losses, open: open, closed: closed, points: pts,
      updated: doc.updated_tehran || ''
    };
  }
  function cmpCell(id, label, eq, start, wins, losses, openN) {
    var pnl = isFinite(eq) && start > 0 ? (eq - start) / start * 100 : NaN;
    var on = view === id ? ' on' : '';
    return '<button type="button" data-fp-view="' + id + '" class="' + on.trim() + '"><span>' + label + '</span><b>' + money(eq, false) + '</b><em class="' + (pnl < 0 ? 'pnl-down' : 'pnl-up') + '">' + pctText(pnl) + '</em><em>W/L ' + wins + '/' + losses + ' · ' + openN + ' open</em></button>';
  }
  function paint() {
    var root = document.getElementById('fastPaperRoot');
    if (!root) return;
    if (!root.querySelector('[data-fp]') || root.dataset.mode !== view) {
      root.innerHTML = shell();
      root.dataset.mode = view;
    }
    var hunter = state.books && state.books.hunter;
    var wild = state.books && state.books.wild;
    var agent = agentModel();
    var cmp = root.querySelector('[data-fp-cmp]');
    if (cmp) {
      cmp.innerHTML = cmpCell('hunter', 'Hunter Fast', equityOf(hunter), (hunter && hunter.start) || 100, (hunter && hunter.wins) || 0, hunter && hunter.exited ? hunter.exited - hunter.wins : 0, hunter && hunter.open ? hunter.open.length : 0)
        + cmpCell('wild', 'Wild Fast', equityOf(wild), (wild && wild.start) || 100, (wild && wild.wins) || 0, wild && wild.exited ? wild.exited - wild.wins : 0, wild && wild.open ? wild.open.length : 0)
        + cmpCell('agent', 'Wild (agent)', agent ? agent.equity : NaN, agent ? agent.start : 100, agent ? agent.wins : 0, agent ? agent.losses : 0, agent ? agent.open.length : 0);
    }
    root.querySelectorAll('[data-fp-src]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-fp-src') === view); });
    var active = view === 'wild' ? wild : view === 'agent' ? null : hunter;
    var eq = view === 'agent' ? (agent ? agent.equity : NaN) : equityOf(active);
    var start = view === 'agent' ? (agent ? agent.start : 100) : ((active && active.start) || 100);
    var pnl = isFinite(eq) ? eq - start : NaN;
    var pct = start > 0 && isFinite(pnl) ? pnl / start * 100 : NaN;
    var eqEl = root.querySelector('[data-fp-eq]');
    if (eqEl) eqEl.textContent = money(eq, false);
    var chips = root.querySelector('[data-fp-chips]');
    if (chips) {
      var cash = view === 'agent' ? (agent ? agent.cash : NaN) : (active && active.cash);
      var realized = view === 'agent' ? (agent ? agent.realized : NaN) : (active && active.realized);
      var record = view === 'agent' ? (agent ? agent.wins + '/' + agent.losses : '—') : wl(active);
      chips.innerHTML = '<span class="' + (pnl < 0 ? 'pnl-down' : 'pnl-up') + '">' + money(pnl, true) + ' · ' + pctText(pct) + '</span><span style="color:var(--muted)">Cash ' + money(cash, false) + '</span><span style="color:var(--muted)">Realized ' + money(realized, true) + '</span><span style="color:var(--muted)">W/L ' + record + '</span>';
    }
    var winsN = active && active.exited ? Math.round(active.wins / active.exited * 100) : 0;
    var tiles = [
      ['Scanner', state.scanned || 0, state.last && state.last.scan || 'Idle'],
      ['Rug check', state.dodged || 0, state.last && state.last.rug || 'Idle'],
      ['Momentum', view === 'agent' ? (agent ? agent.open.length : 0) : ((active && active.bought) || 0), view === 'agent' ? 'Box file' : ((active && active.last && active.last.mom) || 'Idle')],
      ['Exit', view === 'agent' ? (agent ? (agent.wins + '/' + agent.losses) : '—') : (((active && active.exited) || 0) + ' · ' + winsN + '%'), view === 'agent' ? (agent ? clockOf(agent.updated) : '—') : ((active && active.last && active.last.exit) || 'Idle')]
    ];
    var agents = root.querySelector('[data-fp-agents]');
    if (agents) agents.innerHTML = tiles.map(function (t) {
      return '<article class="fp-tile"><span>' + t[0] + '</span><b>' + t[1] + '</b><p>' + esc(String(t[2])) + '</p></article>';
    }).join('');
    var sw = root.querySelector('[data-fp-sw]');
    if (sw) sw.className = 'ios-sw' + (state.on ? ' on' : '');
    var ws = root.querySelector('[data-fp-ws]');
    if (ws) ws.textContent = state.on ? ('Socket ' + (state.ws || '…') + ' · scanned ' + (state.scanned || 0) + ' · both books') : 'Off. Nothing is scanned until you turn it on.';
    paintLists(root, active, agent);
    root.querySelectorAll('[data-fp-range]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-fp-range') === range); });
    draw(root.querySelector('[data-fp-chart]'), view === 'agent' ? (agent && agent.points) : (active && active.equity));
    if (!root.dataset.bound) {
      root.dataset.bound = '1';
      root.addEventListener('click', onClick);
    }
    armLogos(active, agent);
  }
  function paintLists(root, active, agent) {
    var openEl = root.querySelector('[data-fp-open]');
    var closeEl = root.querySelector('[data-fp-closes]');
    var rejWrap = root.querySelector('[data-fp-rej-wrap]');
    var tools = root.querySelector('[data-fp-tools]');
    if (rejWrap) rejWrap.hidden = view === 'agent';
    if (tools) tools.hidden = view === 'agent';
    if (view === 'agent') {
      if (!agent) {
        if (openEl) openEl.innerHTML = '<p class="empty-note">No agent paper yet.</p>';
        if (closeEl) closeEl.innerHTML = '';
        return;
      }
      if (openEl) openEl.innerHTML = agent.open.length ? agent.open.map(function (p) {
        var entry = +p.entry_price;
        var px = quotePx(p.mint, +p.price);
        var ch = entry > 0 && px > 0 ? (px / entry - 1) * 100 : (+p.pnl_pct || 0);
        var dol = isFinite(+p.size_usd) ? +p.size_usd * ch / 100 : NaN;
        return '<div class="paper-row"><div class="flex items-center gap-2 min-w-0">' + logoMark(p.mint, p.symbol) + '<div class="min-w-0"><b>' + esc(p.symbol || '—') + '</b><div class="bot-sub">' + money(p.size_usd, false) + ' · ' + esc(p.opened_tehran || '') + '</div></div></div><div class="ui-pnl ' + (ch < 0 ? 'pnl-down' : 'pnl-up') + '">' + money(dol, true) + '<div>' + pctText(ch) + '</div></div></div>';
      }).join('') : '<p class="empty-note">No open agent positions.</p>';
      if (closeEl) closeEl.innerHTML = agent.closed.length ? agent.closed.slice(0, 8).map(function (c) {
        return '<div class="paper-row"><div class="flex items-center gap-2 min-w-0">' + logoMark(c.mint, c.symbol) + '<div class="min-w-0"><b>' + esc(c.symbol || '—') + '</b><div class="bot-sub">' + esc(c.closed_tehran || '') + ' · ' + esc(c.reason || '') + '</div></div></div><div class="ui-pnl ' + ((+c.pnl_usd) < 0 ? 'pnl-down' : 'pnl-up') + '">' + money(c.pnl_usd, true) + '<div>' + pctText(+c.pnl_pct) + '</div></div></div>';
      }).join('') : '<p class="empty-note">No agent closes yet.</p>';
      return;
    }
    var open = (active && active.open) || [];
    var closed = (active && active.closed) || [];
    if (openEl) openEl.innerHTML = open.length ? open.map(function (p) {
      var px = p.lastPx > 0 ? p.lastPx : p.entryPx;
      var ch = p.entryPx > 0 && px > 0 ? (px / p.entryPx - 1) * 100 : 0;
      var dol = (p.costLeft || 0) * ch / 100;
      return '<div class="paper-row"><div class="flex items-center gap-2 min-w-0">' + logoMark(p.mint, p.symbol) + '<div class="min-w-0"><b>' + esc(p.symbol) + '</b><div class="bot-sub">' + money(p.costLeft, false) + ' · ' + esc(p.setup || '') + '</div></div></div><div class="ui-pnl ' + (ch < 0 ? 'pnl-down' : 'pnl-up') + '">' + money(dol, true) + '<div>' + pctText(ch) + '</div></div></div>';
    }).join('') : '<p class="empty-note">No open paper trades.</p>';
    if (closeEl) closeEl.innerHTML = closed.length ? closed.slice(0, 8).map(function (c) {
      var why = c.reason || ((c.setup ? c.setup + ' · ' : '') + (c.why || ''));
      return '<div class="paper-row"><div class="flex items-center gap-2 min-w-0">' + logoMark(c.mint, c.symbol) + '<div class="min-w-0"><b>' + esc(c.symbol) + '</b><div class="bot-sub">' + esc(c.tehran || '') + ' · ' + esc(why) + '</div></div></div><div class="ui-pnl ' + (c.pnl < 0 ? 'pnl-down' : 'pnl-up') + '">' + money(c.pnl, true) + '</div></div>';
    }).join('') : '<p class="empty-note">No paper closes yet.</p>';
    var rej = (active && active.rej) || {};
    var bits = Object.keys(rej).sort(function (a, b) { return rej[b] - rej[a]; }).slice(0, 6);
    var rejEl = root.querySelector('[data-fp-rej]');
    if (rejEl) rejEl.textContent = bits.length ? bits.map(function (k) { return k + ' ' + rej[k]; }).join(' · ') : 'No rejects yet.';
  }
  function clockOf(s) {
    var m = String(s || '').match(/T(\d{2}:\d{2})/);
    return m ? m[1] : '—';
  }
  function quotePx(mint, fallback) {
    var t = typeof tapeOf === 'function' ? tapeOf(mint) : null;
    if (t && +t.px > 0) return +t.px;
    return fallback > 0 ? fallback : 0;
  }
  function armLogos(active, agent) {
    if (typeof wantLogos !== 'function') return;
    var ids = [];
    if (view === 'agent' && agent) {
      agent.open.forEach(function (p) { ids.push(p.mint); });
      agent.closed.slice(0, 8).forEach(function (c) { ids.push(c.mint); });
    } else if (active) {
      (active.open || []).forEach(function (p) { ids.push(p.mint); });
      (active.closed || []).slice(0, 8).forEach(function (c) { ids.push(c.mint); });
    }
    wantLogos(ids, function () { paint(); });
  }
  function logoMark(mint, symbol) {
    if (typeof logoHtml === 'function') return logoHtml(mint, symbol, 1, 'row', 'paper');
    var ch = esc(String(symbol || '?').slice(0, 1).toUpperCase());
    return '<span class="logo-slot"><span class="mono-logo logo-row logo-tone-paper">' + ch + '</span></span>';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function shell() {
    var note = view === 'wild'
      ? 'Wild Fast: age under 12h, liq at least $10k, accelerating buys, verticals allowed. Size 20% of this book (min $5), max 4. Stop −6%, take profit +30%, 60 min, exit if liquidity is cut in half. 2% slip and 0.5% fee each side.'
      : view === 'agent'
        ? 'Wild (agent) is the box paper file. Read only. It refreshes about once a minute. It cannot buy, sell, or reset.'
        : 'Hunter Fast keeps its filters. Size is a percent of this book’s cash, never marked equity. Stop −6% of entry, take profit +30%, time stop 60 min.';
    return '<section class="hero-card" data-fp>' +
      '<div class="fp-head"><b class="tone tone-paper">Wild Degen Fast</b><span class="ui-pill tone-paper">Paper only</span></div>' +
      '<div class="fp-cmp" data-fp-cmp></div>' +
      '<div class="seg fp-src"><button type="button" data-fp-src="hunter">Hunter Fast</button><button type="button" data-fp-src="wild">Wild Fast</button><button type="button" data-fp-src="agent">Wild (agent)</button></div>' +
      '<div class="fp-bal" data-fp-eq>$100.00</div>' +
      '<div class="fp-chips" data-fp-chips></div>' +
      '<div class="seg fp-range" style="margin-top:12px"><button type="button" data-fp-range="1H">1H</button><button type="button" data-fp-range="4H">4H</button><button type="button" data-fp-range="12H">12H</button><button type="button" data-fp-range="ALL">ALL</button></div>' +
      '<canvas class="fp-chart" data-fp-chart width="360" height="148"></canvas>' +
      '<div class="fp-agents" data-fp-agents></div>' +
      '<p class="bot-sub" data-fp-ws></p>' +
      '<button type="button" class="fp-toggle" data-fp-toggle><span>Engine</span><span class="ios-sw" data-fp-sw><i></i></span></button>' +
      '<p class="bot-sub">' + note + ' This switch cannot sign or spend the burner.</p>' +
      '<h3 class="tone tone-paper" style="margin-top:14px">Open</h3><div data-fp-open></div>' +
      '<h3 class="tone tone-paper" style="margin-top:12px">Recent closes</h3><div data-fp-closes></div>' +
      '<div data-fp-rej-wrap><h3 class="tone tone-paper" style="margin-top:12px">Rejects</h3><p class="bot-sub" data-fp-rej>No rejects yet.</p></div>' +
      '<div class="flex gap-2" data-fp-tools style="margin-top:12px"><button type="button" data-fp-set class="ui-more">Thresholds</button><button type="button" data-fp-csv class="ui-more">CSV</button><button type="button" data-fp-reset class="ui-more">Reset this book</button></div>' +
      '</section>' + sheet();
  }
  function sheet() {
    if (view === 'agent') {
      return '<div id="fpSheet" class="token-sheet" role="dialog" aria-label="Agent paper"><div class="sheet-grab"></div><div class="flex items-center justify-between"><b>Wild (agent)</b><button type="button" data-fp-close class="ui-more">Close</button></div><p class="bot-sub">Read only. Loaded from the box paper file.</p></div>';
    }
    var id = view === 'wild' ? 'wild' : 'hunter';
    var settings = state.books && state.books[id] && state.books[id].settings;
    var fields = FIELD_LIST.map(function (f) {
      var val = settings && isFinite(+settings[f[0]]) ? settings[f[0]] : defs(id)[f[0]];
      return '<label>' + f[1] + '<input data-fp-field="' + f[0] + '" inputmode="decimal" value="' + val + '"></label>';
    }).join('');
    return '<div id="fpSheet" class="token-sheet" role="dialog" aria-label="Fast paper thresholds"><div class="sheet-grab"></div><div class="flex items-center justify-between"><b>' + (id === 'wild' ? 'Wild' : 'Hunter') + ' thresholds</b><button type="button" data-fp-close class="ui-more">Close</button></div>' + fields +
      '<button type="button" data-fp-save class="ui-btn" style="width:100%;min-height:44px;margin-top:14px">Save this book</button></div>';
  }
  function onClick(e) {
    var t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-fp-view') || t.hasAttribute('data-fp-src')) {
      view = t.getAttribute('data-fp-view') || t.getAttribute('data-fp-src');
      save();
      paint();
      return;
    }
    if (t.hasAttribute('data-fp-range')) { range = t.getAttribute('data-fp-range'); paint(); return; }
    if (t.hasAttribute('data-fp-toggle')) { toggle(); return; }
    if (t.hasAttribute('data-fp-set')) { var sheetEl = document.getElementById('fpSheet'); if (sheetEl) sheetEl.classList.add('open'); return; }
    if (t.hasAttribute('data-fp-close')) { var closeEl = document.getElementById('fpSheet'); if (closeEl) closeEl.classList.remove('open'); return; }
    if (t.hasAttribute('data-fp-save')) { saveSettings(); return; }
    if (t.hasAttribute('data-fp-reset')) { resetActive(); return; }
    if (t.hasAttribute('data-fp-csv')) csv();
  }
  function toggle() {
    var turningOn = !state.on;
    state.on = turningOn;
    if (!booted) boot();
    else worker.postMessage({ type: turningOn ? 'on' : 'off' });
    paint();
    if (typeof toast === 'function') toast(turningOn ? 'Hunter and Wild are paper-only' : 'Wild Degen Fast off', 'info');
  }
  function saveSettings() {
    if (view === 'agent') return;
    var id = view === 'wild' ? 'wild' : 'hunter';
    var next = {};
    document.querySelectorAll('[data-fp-field]').forEach(function (el) { next[el.getAttribute('data-fp-field')] = el.value; });
    state.books[id].settings = clean(next, id);
    boot();
    worker.postMessage({ type: 'settings', book: id, settings: state.books[id].settings });
    var sheetEl = document.getElementById('fpSheet');
    if (sheetEl) sheetEl.classList.remove('open');
    save();
    if (typeof toast === 'function') toast((id === 'wild' ? 'Wild' : 'Hunter') + ' thresholds saved', 'ok');
  }
  function resetActive() {
    if (view === 'agent') return;
    var id = view === 'wild' ? 'wild' : 'hunter';
    var name = id === 'wild' ? 'Wild Fast' : 'Hunter Fast';
    if (!window.confirm('Reset the ' + name + ' paper book to its starting cash? Real wallets stay untouched.')) return;
    boot();
    worker.postMessage({ type: 'reset', book: id });
    var sheetEl = document.getElementById('fpSheet');
    if (sheetEl) sheetEl.classList.remove('open');
  }
  function csv() {
    var lines = ['tehran,symbol,mint,entry,exit,pnl_usd,reason'];
    if (view === 'agent') {
      var agent = agentModel();
      if (!agent) return;
      agent.closed.forEach(function (c) {
        lines.push([q(c.closed_tehran), q(c.symbol), c.mint, c.entry_price, c.exit_price, c.pnl_usd, q(c.reason)].join(','));
      });
    } else {
      var b = state.books && state.books[view === 'wild' ? 'wild' : 'hunter'];
      (b && b.closed || []).forEach(function (c) {
        lines.push([q(c.tehran), q(c.symbol), c.mint, c.entry, c.exit, c.pnl, q(c.reason || c.why)].join(','));
      });
      (b && b.open || []).forEach(function (p) {
        lines.push(['', q(p.symbol), p.mint, p.entryPx, '', '', q(p.setup || 'open')].join(','));
      });
    }
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wild-degen-fast-' + view + '.csv';
    a.click();
  }
  function q(s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; }
  function draw(canvas, points) {
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
    var pts = (points || []).filter(function (p) { return !span || now - p.t <= span; });
    if (!pts.length) pts = [{ t: now, v: 100, dot: '' }];
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
  if (!agentTimer) {
    agentTimer = setInterval(function () {
      if (typeof paperRefresh === 'function') paperRefresh();
    }, 60000);
  }
  if (typeof paperEnsure === 'function') paperEnsure();
  if (state._resume) { state.on = true; boot(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
  else paint();
})();
