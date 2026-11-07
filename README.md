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
  - shows average entry (the on-chain fill when available), live PnL, the stop from the analysis, and TP1/TP2 at +50% / +100% of that entry;
  - highlights STOP HIT / TP hit as **alerts only**;
  - exports to CSV.

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
- Optional **auto-exit** (sell at the stop, sell 50% at +50% from the stored average entry, sell 50% of the rest at +100%, then trail the rest / time stop) and **auto-scan** (Scan latest boosted every N minutes, at least 5). Existing positions use the new targets from their stored entry.
- Optional token age overrides on Inputs: **Min age (hours)** and **Max age (days)**. Leave them blank to keep the risk preset (Balanced is 1.0h–7.0d).
- A **KILL SWITCH** is in the panel, and a floating button appears while auto mode is on. Every automatic action goes to the auto-trade log.
- **It only works while the tab is open.** Browsers slow down background tabs. **Only fund small amounts.**

## GitHub Pages
All URLs in the page are relative or external, so it works from a subpath such as `https://user.github.io/repo/`. Put `index.html` at the repo root (or in `/docs`) and turn on Pages.

## Endpoints
- DexScreener (prices, pairs, boosts), RugCheck (checklist), CoinGecko (SOL price fallback).
- Jupiter Swap API v1: `https://lite-api.jup.ag/swap/v1/quote` and `/swap`, with `https://api.jup.ag/swap/v1` as fallback (optional API key). Jupiter marks v1 as superseded by v2 (`/swap/v2/order`). v1 still works and returns a transaction that Phantom's `signAndSendTransaction` can sign and send.
- RPC (Settings), default `https://solana-rpc.publicnode.com`:
  - `api.mainnet-beta.solana.com` returns 403 to browsers, so it isn't the default.
  - PublicNode's free tier blocks indexed calls, so the panel reads token balances from each token's associated account instead.
  - For reliability, use your own free Helius or QuickNode RPC URL.
