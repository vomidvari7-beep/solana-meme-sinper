# Agent files

The panel reads these JSON files from `main` every few minutes:

`https://raw.githubusercontent.com/vomidvari7-beep/solana-meme-sinper/main/agents/<file>.json`

Times are Unix milliseconds. The panel ignores a plan older than 2 hours or past `expires`, and a risk note older than 30 minutes. Write the whole file when you update it. Do not put private keys in any file.

## candidates.json

Hunter output. Either a bare array, or an object `{ updated_utc, updated_tehran, candidates: [ ... ] }`. `ts` on each row may be Unix milliseconds or an ISO time.

| Field | Meaning |
| --- | --- |
| `mint` | Token mint address |
| `symbol` | Ticker |
| `pair` | Pool address, if known |
| `score` | 0–100 rank |
| `reason` | Why it was picked |
| `safety` | Short safety note |
| `ts` | When the hunter wrote the row |

## mylist.json

Watchlist the agents share. An array of `{mint, symbol, addedTs}`. The panel does not import this file by itself. Use **Copy My List for agents** in settings to produce the same shape from the browser list.

## plans.json

Entry Analyst output. An array.

| Field | Meaning |
| --- | --- |
| `mint`, `symbol` | Token |
| `setup` | Setup name shown on the chip |
| `tf` | Chart timeframe, such as `4h` |
| `trigger_price` | Price that arms the buy |
| `trigger_condition` | `above`, `below`, `retest`, or `immediate` |
| `entry_mode` | `immediate`, `retest`, or `break` (price at or above `trigger_price`) |
| `scale_in` | `true` to start with 30%, `false` to buy the full size |
| `stop`, `tp1`, `tp2` | Prices. A stop or take-profit the user set on that token wins |
| `trail` | Trail percent after the entry, optional |
| `rr` | Reward to risk, optional |
| `confidence` | 0–100. Auto-buy needs at least 60 |
| `status` | `ready`, `waiting`, or `invalid` |
| `expires` | Unix milliseconds or an ISO time. After this the plan is ignored |
| `reason` | One line for the chip and the trade log |
| `ts`, `updatedAt` | When the plan was written, as Unix milliseconds or an ISO time. A plan older than 2 hours is ignored |

Auto-buy uses a plan only when **Use agent plans** is on, `status` is `ready`, confidence is at least 60, the plan is not stale, and that token’s My List switch or scanner Auto is already on. The usual size caps still apply.

## risk.json

```json
{
  "pause_auto_buy": false,
  "ts": 0,
  "positions": [
    {
      "mint": "",
      "action": "hold",
      "new_stop": 0,
      "partial_pct": 0,
      "reason": "",
      "ts": 0
    }
  ]
}
```

`action` is `raise_stop`, `take_partial`, `exit_now`, or `hold`.

- `pause_auto_buy` stops new scanner auto-buys while `ts` is under 30 minutes old. My List is unchanged. The panel shows a banner.
- `raise_stop` moves the stop up to `new_stop` only when that price is above the current stop and below the live price.
- `take_partial` sells `partial_pct` (default 50) and `exit_now` sells the position only when **Agent exits** is on. Otherwise the position card shows a red alert and plays a sound.

## config.json

`burner_public_address` is the public key only. `notes` is free text for the team. The panel never writes a private key here.
