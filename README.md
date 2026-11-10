# SolanaMemeSniper Panel

A single-file dashboard (`index.html`, no build step) for the SolanaMemeSniper framework: rug filter → verification checklist → conviction score (40/25/20/15) → entry / exit plan.
On top of that it can **trade for real**: Jupiter swaps signed in **Phantom**, plus an optional **burner wallet** in the browser that can auto-trade within hard caps.

> ⚠️ Analysis only, not financial advice. Real swaps can't be undone. Most meme coins go to zero.

---
## Run (English)
**Phantom only works on https:// or http://localhost. It does not work when you open the file directly (file://).**

**Desktop (Chrome/Brave + Phantom extension)**
1. Unzip, then in the folder run: `python3 -m http.server 8000`
2. Open `http://localhost:8000` in Chrome with the Phantom extension → click **Connect Phantom**.
   (Or open the public https URL, if one has been set up.)

**Phone (Phantom app)**
- Open the Phantom app → 🔍 Browser tab → paste the panel's **https** URL.
  The "open in Phantom app" link inside the page does the same thing.
- Your phone can't reach `localhost`, so it needs the https URL (or a LAN URL served with https).

## اجرا (فارسی)
**Phantom فقط روی https یا http://localhost کار می‌کند. اگر فایل را مستقیم باز کنی (file://) کار نمی‌کند.**

**دسکتاپ (Chrome با افزونه‌ی Phantom):**
1. فایل zip را باز کن و داخل پوشه این دستور را بزن: `python3 -m http.server 8000`
2. در Chrome آدرس `http://localhost:8000` را باز کن و روی **Connect Phantom** بزن (یا لینک https عمومی را باز کن).

**موبایل (اپ Phantom):**
- اپ Phantom را باز کن، به تب Browser (ذره‌بین) برو و لینک **https** پنل را وارد کن.
- گوشی به localhost دسترسی ندارد، پس حتماً لینک https لازم است.

---
## Trading features
- **Phantom:** connect/disconnect, address, SOL balance, and token balances for the analysed tokens. Every trade opens a confirmation window (amount in/out, minimum received, price impact, slippage, route, priority fee, quote age) and then **you sign it in Phantom**. The page then shows the Solscan link and polls until the trade is confirmed.
- **Per card:** Buy (SOL amount pre-filled from the position size: risk % ÷ stop distance, first tranche 40%, capped) and Sell 25 / 50 / 100%.
- **Size unit** (Auto-trade hard caps, and the safety settings): **USD** or **SOL**, saved in `sms:sizeunit`. USD is the default. Amounts are stored in the unit you typed, so a $25 cap stays $25. Existing SOL caps are converted once, at the current SOL price, when the unit changes. Percent-of-balance fields stay percents. If the SOL price is missing, USD-sized auto buys stop with a clear message; SOL sizes can still be used manually.
- **Safety guards:**
  - global max SOL per trade (default 0.1) and global daily max (default 0.3 SOL, manual + auto), both editable under Auto-trade hard caps with no upper limit;
  - the separate auto daily cap is not clamped to 0.3;
  - max open positions (default 2, integer 1–20) overrides the Risk Tolerance preset for guards and displayed limits;
  - burner buys are also capped at a percentage of the burner SOL balance (default 20%);
  - a SOL reserve kept back for fees;
  - slippage ≤ 15% (default 3%);
  - price impact above 5% is blocked unless you tick an override;
  - tokens with red flags or failed checklist items need an extra confirmation;
  - "Confirm every trade" is always on.
- **Trade log (localStorage) + positions:**
  - shows average entry (the on-chain fill when available), live PnL, the effective stop and why it is there (initial, break-even, early trail, or trail), and TP1/TP2 at +50% / +100% of that entry;
  - highlights STOP HIT / TP hit as **alerts only**;
  - exports to CSV.
  - Open positions are cards (table view still available): source badge, live P&amp;L, a stop-to-target bar, and sell buttons.
  - **Closed trades** sit under the open cards. Buys and sells on the same token form one round trip until the balance is about zero; partial sells stay in that trip. Each card shows Tehran open/close time, hold time, average entry and exit, SOL in and out, realized P&amp;L in USD (SOL and % beside it), and the exit reason. The header totals P&amp;L, win rate, average win and loss, best and worst, and profit factor, with Today / Week / Month / All and source filters. USD uses the SOL price stored on the fill (`solUsd`); if that is missing the live price is used and marked ≈. New fills record `solUsd`.
  - **Wealth growth** charts burner equity (SOL balance + open positions, in SOL and USD). Snapshots land in `sms:equity` about every 5 minutes while the page is open and whenever a burner trade closes. Old points are downsampled and kept for about a year. Day / Week / Month / All use Tehran time (UTC+3:30). The unit defaults to USD and is remembered. Week and month also show daily realized P&amp;L.

## Burner wallet + auto-trading (optional)
- The keypair is generated in the browser. The secret key is encrypted with your passphrase (PBKDF2-SHA256 310k → AES-GCM-256) and stored **only in this browser's localStorage**. It is never sent anywhere.
- **Import existing key:** paste a base58 private key (Phantom export) or a JSON byte array (64 bytes). The panel shows the derived address for you to confirm, then encrypts the key the same way as a generated burner. Use a dedicated small-balance wallet, never your main one.
- Deposit address with QR code and copy, balance, Unlock/Lock, **Export key** (needs your passphrase + a warning), **Withdraw all SOL**, Delete.
- **Auto-trade is OFF by default** and is always OFF again after a page reload.
- Hard caps (defaults):
  - 0.05 SOL per auto trade, 0.2 SOL per auto day, plus the global 0.1 / 0.3 SOL caps;
  - at most 20% of the burner's SOL balance per buy (uses the last known balance if RPC fails);
  - conviction ≥ 65, price impact ≤ 5%, slippage cap 3%;
  - max open positions (default 2);
  - only Candidates with LP, mint/freeze and top-10 verified, no medium/high flags, not on the bonding curve;
  - the price must be inside the entry zone and the analysis less than 60 minutes old;
  - one buy per token.
- Optional **auto-exit** (sell at the stop, sell 50% at +50% from the stored average entry, sell 50% of the rest at +100%, then trail the rest / time stop) and **auto-scan** (scan the selected sources every N minutes, at least 5). **Scan sources** merges DexScreener boosts and profiles, DexScreener searches for pumpswap / raydium / meteora, and GeckoTerminal trending, top-volume, and new pools (two pages each). Checkboxes **Boosted**, **Trending**, **Top volume**, and **New pools** default on and are saved in `sms:autocfg`. A failed source is skipped. Cards show a source chip. The merged list is still pre-ranked before the deep checks. Before TP1 the stop only moves up: break-even at +% (default 25) lifts it to entry +1%, and early trail at +% (default 40) trails Early trail % (default 18) under the high. After TP1 the stop is the tighter of that trail and the profile trail. The same stop is used for scanner buys, whale copies, and alerts. Existing positions use the new targets from their stored entry.
- Optional token age overrides on Inputs: **Min age (hours)** and **Max age (days)**. Leave them blank to keep the risk preset (Balanced is 1.0h–7.0d).

## My List
- Paste mints in **Pasted screener data / token list**, then **Save as My List**, or add a mint on the My List card. The list is stored in `sms:mylist`. Each token is a card: logo, live price, 1h/24h change, a chart thumbnail (trendline, support and resistance, trigger, stop, and targets; tap for the full chart, then pick 1m / 5m / 15m / 1h / 4h), the setup, and a verdict. **Strategy** edits that token, **Buy now** sends a market buy with the same caps, and **Table view** is the compact list. Sort is **Ready first** or **Distance to trigger**. The default strategy and the auto-buy switch sit at the top of the card. The list default timeframe is 4h (a saved default that was still 5m moves to 4h; a per-token timeframe is left as saved). Trendline break and resistance break can use 1m, 5m, 15m, 1h, or 4h. If 4h has fewer than 20 candles, the chart and the break check step down to 1h, then 15m, and the card says `TF 1h (4h: not enough history)`. Scanner cards open a display chart on 4h the same way. Momentum, sniper, and the scanner entry-zone timeframe stay on their short candles. A 1h or 4h signal waits for that candle’s close (`waiting for 1h close`). Early trigger, off by default, accepts a 5m close above the higher-timeframe level. The card trigger reads like `Trendline break 4h @ $x`. The card face is a header, a short chart, and one summary (setup, trigger, stop, and the upside with R:R). Price, levels, the ATH zone, room to resistance, the plan, and warnings sit under Details, collapsed until opened, and that open state is remembered on the token. Resistance distance uses the same price as the resistance line. The analysis detail still has Room to resistance (distance to the next resistance, the upside if that breaks, distance to support, and the R:R of those two). Candle support and resistance are scaled into the token’s USD price when the pool series comes back in the other asset, and the planned stop stays under the live price and under the support zone. The chart draws the full candle history on a log scale when the range is wide: a white descending trendline, a purple ATH zone at the highest highs, and a BUY ZONE where the trendline meets that band. The list default setup is Trendline + Resistance break (confluence), which buys a close above both lines. ATH / range-high breakout buys the high band: Immediate on the close, Hold after N closes above (default 2), or Retest (default) after a pullback to the band and a green close back above it. The ATH stop sits under the band, the target is the measured move, and a trail runs from the breakout.
- These tokens skip RugCheck, insider, liquidity, age, and conviction blocks. Flags still show as info. A buy still needs a Jupiter route and stays inside max positions, balance %, max per trade, and the daily cap.
- **My List auto-buy** is off after every reload. While it is on, the 30s tick can buy: S/R zone, momentum breakout, a price range, or buy now. Size is a SOL amount or a percent of balance. The exit plan (stop, take-profit steps, breakeven, trail, optional time stop) is stored on that position and shown on the position card. After a close, **Look for a new entry after a close** can buy again, with a cooldown and a daily re-entry cap. The new buy uses the new fill for its stop and targets.
- Open My List positions are badged **MY LIST**. **Edit stop** on the card can change the stop, TPs, breakeven, and trail for that open position.

## Whale copy-trade
- Section **Whale copy-trade**. List is stored in `sms:whales` (`label`, `wallet`, `tier` `core` or `confirm`, optional per-whale `min` / `max` USD). Other copy settings are in `sms:copycfg`.
- Group limits at the top of each list: **Min whale buy USD** and **Max whale buy USD**. Empty means no limit. Defaults: core min 500, confirm min 20000 (this replaces a single big-buy threshold), both max empty. A whale's own min/max overrides its group. Buys outside the range are logged as `ignored: size` and do not trigger.
- Triggers: in-range core buy (A), in-range confirm buy (B), or at least 2 distinct in-range whales on the same token within the cluster window (C, default 6h).
- Rug check: hard blocks (mint or freeze still active, LP not locked/burned unless the pool is pump.fun-graduated or PumpSwap, Jupiter sell quote fails, liquidity under the minimum default $10k) never buy. Soft flags (young age, no socials, RugCheck unknown, top-10 up to 40%, low volume or conviction) still buy, but tranche 1 is 30% of the capped size instead of 50%.
- **Copy tranche 1 (SOL)** and **Copy tranche 2 (SOL)**: when filled, those amounts replace the 50/50 split. A soft flag uses tranche 1 × 0.6. When empty, sizing falls back to the percentages. The whole position is still clamped by the global per-trade max and the burner balance percent; daily max and max open positions still block.
- Copy mode is off after every reload, needs the burner unlocked, and the kill switch stops it. The feed uses Tehran time. Copied trades are tagged `copy`.
- Optional **Custom RPC URL** in that section is used for every RPC call when set. Polls about every 25s, only signatures that arrive after copy mode is armed.
- A **KILL SWITCH** is in the panel, and a floating button appears while auto mode is on. Every automatic action goes to the auto-trade log.
- **It only works while the tab is open.** Browsers slow down background tabs. **Only fund small amounts.**

## GitHub Pages
All URLs in the page are relative or external, so it works from a subpath such as `https://user.github.io/repo/`. Put `index.html` at the repo root (or in `/docs`) and turn on Pages.

## Endpoints
- DexScreener (prices, pairs, boosts), RugCheck (checklist and holder counts), CoinGecko (SOL price fallback). Holder snapshots stay in `sms:holders` for about 24 hours. A 1h drop over 3% flags `Holders falling` and blocks a normal auto-buy. My List only shows that flag as info. Until a second snapshot exists, the card says `collecting…` and the score stays neutral.
- GeckoTerminal OHLCV for the top 10 pools (5m/15m, 15m/1h, or 1h/4h by token age). Swing highs and lows cluster into support/resistance zones. A reversal candle at a strong support plus a close through the descending trendline or resistance on ≥1.5× volume labels the token `BREAKOUT ✅`; the same setup still under the line is `Breakout watch 👀`. Those labels, levels, and pattern names are on the card, in Copy Results, and in the AI prompt. "Breakout only" filters the ranking. Auto-trade can optionally buy only BREAKOUT-confirmed tokens (off by default); the entry is a retest of the broken level and the stop sits under the reversal candle or the support zone, still inside the profile's max stop. A higher-timeframe downtrend without a break lowers conviction and blocks auto-buys. If candles fail, the card says `TA: unavailable` and the old %-change read is kept. Whale copies are not blocked by any of this.
- **Mood pause** (Auto-trade hard caps, off by default): two fear/greed gauges sit by the SOL price. SOL mood uses 5m/1h/6h/24h change. DEX Mood is recomputed each scan from buy/sell ratios, the share of tokens up on 1h/6h, volume acceleration, and new-token flow, with the last 24h kept in `sms:dexmood` (Tehran labels on the sparkline). Auto-buys and whale copy-buys can pause or halve when the SOL gauge, the DEX gauge, or both drop under their own threshold (default 25). Stops, targets, trailing, and whale-mirrored sells keep running.
- Jupiter Swap API v1: `https://lite-api.jup.ag/swap/v1/quote` and `/swap`, with `https://api.jup.ag/swap/v1` as fallback (optional API key). Jupiter marks v1 as superseded by v2 (`/swap/v2/order`). v1 still works and returns a transaction that Phantom's `signAndSendTransaction` can sign and send.
- RPC (Settings), default `https://solana-rpc.publicnode.com`:
  - `api.mainnet-beta.solana.com` returns 403 to browsers, so it isn't the default.
  - PublicNode's free tier blocks indexed calls, so the panel reads token balances from each token's associated account instead.
  - For reliability, use your own free Helius or QuickNode RPC URL.
