/* Wild Fast — read only.
   The card shows the box agent's paper book. It does not open a socket,
   poll prices for entries, or place a paper buy. The old in-browser books
   are gone; their saved key is cleared here. */
(function () {
  try { localStorage.removeItem('sms:fastpaper'); } catch (e) {}
  var range = 'ALL';
  var timer = 0;

  function money(n, signed) {
    if (!isFinite(+n)) return '—';
    var sign = signed ? (+n > 0 ? '+' : +n < 0 ? '−' : '') : (+n < 0 ? '−' : '');
    return sign + '$' + Math.abs(+n).toFixed(2);
  }
  function pctText(n) {
    if (!isFinite(+n)) return '—';
    return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(1) + '%';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function agoText(raw) {
    var ms = Date.parse(raw || '');
    if (!isFinite(ms)) return 'updated —';
    var sec = Math.max(0, (Date.now() - ms) / 1000);
    var label = sec < 60 ? Math.max(1, Math.round(sec)) + 's'
      : sec < 3600 ? Math.floor(sec / 60) + 'm'
      : sec < 86400 ? Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm'
      : Math.floor(sec / 86400) + 'd';
    return 'updated ' + label + ' ago';
  }
  function doc() {
    var box = window.SMSPaper;
    return box && box.doc && typeof box.doc === 'object' ? box.doc : null;
  }
  function quotePx(mint, fallback) {
    var t = typeof tapeOf === 'function' ? tapeOf(mint) : null;
    if (t && +t.px > 0) return +t.px;
    return +fallback > 0 ? +fallback : 0;
  }
  function logoMark(mint, symbol) {
    if (typeof logoHtml === 'function') return logoHtml(mint, symbol, 1, 'row', 'paper');
    var ch = esc(String(symbol || '?').slice(0, 1).toUpperCase());
    return '<span class="logo-slot"><span class="mono-logo logo-row logo-tone-paper">' + ch + '</span></span>';
  }
  function liveRow(p) {
    var entry = +p.entry_price;
    var px = quotePx(p.mint, +p.price);
    var ch = entry > 0 && px > 0 ? (px / entry - 1) * 100 : (isFinite(+p.pnl_pct) ? +p.pnl_pct : 0);
    var dol = isFinite(+p.size_usd) ? +p.size_usd * ch / 100 : (isFinite(+p.pnl_usd) ? +p.pnl_usd : NaN);
    return { ch: ch, dol: dol };
  }
  function model() {
    var file = doc();
    if (!file) return null;
    var start = +file.start_usd || 100;
    var closed = Array.isArray(file.closed) ? file.closed : [];
    var open = Array.isArray(file.open) ? file.open : [];
    var wins = 0, losses = 0;
    closed.forEach(function (c) { if (+c.pnl_usd >= 0) wins++; else losses++; });
    var unreal = 0, live = false;
    open.forEach(function (p) {
      var row = liveRow(p);
      if (isFinite(row.dol)) { unreal += row.dol; live = true; }
    });
    if (!live && isFinite(+file.unrealized_pnl_usd)) unreal = +file.unrealized_pnl_usd;
    var pts = [];
    var rows = closed.slice().reverse();
    var v = start;
    var t0 = rows.length ? Date.parse(rows[0].closed_tehran) : NaN;
    pts.push({ t: (isFinite(t0) ? t0 : Date.now()) - 60000, v: start, dot: '' });
    rows.forEach(function (c) {
      v = Math.round((v + (+c.pnl_usd || 0)) * 100) / 100;
      var t = Date.parse(c.closed_tehran);
      pts.push({ t: isFinite(t) ? t : Date.now(), v: v, dot: (+c.pnl_usd || 0) < 0 ? 'loss' : 'win' });
    });
    var equity = isFinite(+file.equity_usd) ? +file.equity_usd : v;
    pts.push({ t: Date.now(), v: equity, dot: '' });
    return {
      start: start,
      equity: equity,
      cash: +file.cash_usd,
      realized: +file.realized_pnl_usd,
      unreal: unreal,
      wins: wins,
      losses: losses,
      open: open,
      closed: closed,
      points: pts,
      ago: agoText(file.updated_utc || file.updated_tehran)
    };
  }
  function paint() {
    var root = document.getElementById('fastPaperRoot');
    if (!root) return;
    if (!root.querySelector('[data-fp]')) {
      root.innerHTML = shell();
      root.dataset.bound = '';
    }
    var book = model();
    var err = window.SMSPaper && window.SMSPaper.err;
    var eqEl = root.querySelector('[data-fp-eq]');
    var chips = root.querySelector('[data-fp-chips]');
    var ageEl = root.querySelector('[data-fp-age]');
    var openEl = root.querySelector('[data-fp-open]');
    var closeEl = root.querySelector('[data-fp-closes]');
    if (!book) {
      if (eqEl) eqEl.textContent = '—';
      if (chips) chips.innerHTML = '';
      if (ageEl) ageEl.textContent = err || 'Reading the paper file…';
      if (openEl) openEl.innerHTML = '<p class="empty-note">No paper data yet.</p>';
      if (closeEl) closeEl.innerHTML = '';
      draw(root.querySelector('[data-fp-chart]'), []);
      bind(root);
      return;
    }
    var pnl = book.equity - book.start;
    var pct = book.start > 0 ? pnl / book.start * 100 : NaN;
    if (eqEl) eqEl.textContent = money(book.equity, false);
    if (chips) chips.innerHTML = '<span class="' + (pnl < 0 ? 'pnl-down' : 'pnl-up') + '">' + money(pnl, true) + ' · ' + pctText(pct) + '</span><span style="color:var(--muted)">Cash ' + money(book.cash, false) + '</span><span style="color:var(--muted)">Realized ' + money(book.realized, true) + '</span><span style="color:var(--muted)">Unrealized ' + money(book.unreal, true) + '</span><span style="color:var(--muted)">W/L ' + book.wins + '/' + book.losses + '</span>';
    if (ageEl) ageEl.textContent = book.ago;
    if (openEl) openEl.innerHTML = book.open.length ? book.open.map(function (p) {
      var row = liveRow(p);
      return '<div class="paper-row"><div class="flex items-center gap-2 min-w-0">' + logoMark(p.mint, p.symbol) + '<div class="min-w-0"><b>' + esc(p.symbol || '—') + '</b><div class="bot-sub">' + money(p.size_usd, false) + ' · ' + esc(p.opened_tehran || '') + '</div></div></div><div class="ui-pnl ' + (row.ch < 0 ? 'pnl-down' : 'pnl-up') + '">' + money(row.dol, true) + '<div>' + pctText(row.ch) + '</div></div></div>';
    }).join('') : '<p class="empty-note">No open paper positions.</p>';
    if (closeEl) closeEl.innerHTML = book.closed.length ? book.closed.slice(0, 20).map(function (c) {
      return '<div class="paper-row"><div class="flex items-center gap-2 min-w-0">' + logoMark(c.mint, c.symbol) + '<div class="min-w-0"><b>' + esc(c.symbol || '—') + '</b><div class="bot-sub">' + esc(c.closed_tehran || '') + ' · ' + esc(c.reason || '') + '</div></div></div><div class="ui-pnl ' + ((+c.pnl_usd) < 0 ? 'pnl-down' : 'pnl-up') + '">' + money(c.pnl_usd, true) + '<div>' + pctText(+c.pnl_pct) + '</div></div></div>';
    }).join('') : '<p class="empty-note">No closed paper trades.</p>';
    root.querySelectorAll('[data-fp-range]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-fp-range') === range);
    });
    draw(root.querySelector('[data-fp-chart]'), book.points);
    bind(root);
    if (typeof wantLogos === 'function') {
      var ids = book.open.map(function (p) { return p.mint; }).concat(book.closed.slice(0, 12).map(function (c) { return c.mint; }));
      wantLogos(ids, function () { paint(); });
    }
  }
  function bind(root) {
    if (root.dataset.bound) return;
    root.dataset.bound = '1';
    root.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t || !t.hasAttribute('data-fp-range')) return;
      range = t.getAttribute('data-fp-range');
      paint();
    });
  }
  function shell() {
    return '<section class="hero-card" data-fp>' +
      '<div class="fp-head"><b class="tone tone-paper">Wild Fast</b><span class="ui-pill tone-paper">read only</span></div>' +
      '<p class="bot-sub">Stop −10% · TP +30% · runs 24/7</p>' +
      '<p class="bot-sub" data-fp-age>updated —</p>' +
      '<div class="fp-bal" data-fp-eq>—</div>' +
      '<div class="fp-chips" data-fp-chips></div>' +
      '<div class="seg fp-range" style="margin-top:12px"><button type="button" data-fp-range="1H">1H</button><button type="button" data-fp-range="4H">4H</button><button type="button" data-fp-range="12H">12H</button><button type="button" data-fp-range="ALL">ALL</button></div>' +
      '<canvas class="fp-chart" data-fp-chart width="360" height="148"></canvas>' +
      '<h3 class="tone tone-paper" style="margin-top:14px">Open</h3><div data-fp-open></div>' +
      '<h3 class="tone tone-paper" style="margin-top:12px">Closed</h3><div data-fp-closes></div>' +
      '</section>';
  }
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
  if (!timer) {
    timer = setInterval(function () {
      if (typeof paperRefresh === 'function') paperRefresh();
    }, 60000);
  }
  if (typeof paperEnsure === 'function') paperEnsure();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
  else paint();
})();
