# SolanaMemeSniper daemon

Headless Node.js process that keeps trading when Safari is closed. It follows the live panel rules from commit `9daa884` and the fake-data guards:

- Scalp uses its own ledger, starting at $100. The first position takes half of the free balance. The second takes the rest, and only if the first is at breakeven. Skip under $5. Max 2 open. Daily stop -$20. At +5% it holds and trails only while 1-minute momentum is strong.
- My List breakout buys use a stop 1.5% under the strongest break candle, never wider than -15%, and a +30% target.
- Agent plans buy when confidence is at least 60, the plan is fresh and `ready`, and price touches the trigger.
- Live Degen scan buys from the Degen ledger and uses the tiered exit (stop, +50% breakeven, +80% trail, partials, time stop).
- AVOID, confidence 0, rug flags, zero sells, liquidity above 20× 24h volume or above market cap, and a Jupiter quote with no impact are skipped as `fake-data`. A mint that falls 80% inside an hour is stored in the blacklist and never bought again.

The browser panel does not change its trading while Server mode is off.

## English setup (Ubuntu 22.04 or 24.04)

The private key is never committed, never logged, and never sent to an agent.

```bash
sudo bash server/install.sh
```

That installs Node 20 if needed, creates the `sms` user, copies the app to `/opt/sms`, and starts `sms-daemon` with `SMS_DRY_RUN=1`. Dry-run logs decisions and does not send transactions.

### Put the key on the machine

Use one of these. Do both only if you want a spare. The plaintext file is shredded after encryption.

**Setup page (recommended).** From your laptop:

```bash
ssh -L 8788:127.0.0.1:8788 user@YOUR_VPS
```

Open `http://127.0.0.1:8788`. The page refuses every address except localhost. Type the burner secret, a passphrase (8+ characters), and the API token the phone will use (12+ characters). The daemon encrypts the key with scrypt and AES-256-GCM into `/var/lib/sms/key.enc` and stores only the API token in `/var/lib/sms/api.token` (mode 600).

**File the owner creates.**

```bash
sudo install -m 600 /dev/stdin /etc/sms/key
# paste the base58 secret or the JSON byte array, then Ctrl-D
sudo install -m 600 /dev/stdin /etc/sms/passphrase
# type the passphrase, then Ctrl-D
sudo systemctl restart sms-daemon
```

On the next start the daemon encrypts `/etc/sms/key` into `/var/lib/sms/key.enc` and deletes the plaintext file. Later restarts read the passphrase from `/etc/sms/passphrase` or from `SMS_PASSPHRASE`. Without a passphrase, the daemon waits on the localhost page instead of trading.

Accepted key forms: Phantom base58 secret, 64-byte JSON array, or hex.

### Turn on live trading

Edit `/etc/sms/sms.env` and set `SMS_DRY_RUN=0`, then `sudo systemctl restart sms-daemon`. Modes still start off. Enable them from the phone or:

```bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" -H 'content-type: application/json' \
  -d '{"scalp":true,"breakout":true,"plans":true,"degen":true,"scan":true}' \
  http://127.0.0.1:8787/api/mode
```

### Phone

In the panel, Wallet & Trading → Server mode. Paste `http://YOUR_VPS:8787` and the API token, tick Use the server, Save. The card shows positions, ledger balances, and the mode checkboxes. Pause all calls `POST /api/pause`. While Server mode is on, this browser will not sign scalp, breakout, plan, degen, or auto buys.

The status API is read-only except pause, resume, and those toggles. There is no endpoint that places a trade.

### Status

```bash
sudo systemctl status sms-daemon
sudo journalctl -u sms-daemon -f
curl -s -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:8787/api/status
```

State (positions, both ledgers, blacklist, cooldowns) is `/var/lib/sms/book.json`. A restart continues from that file.

## راه‌اندازی فارسی

این پردازش حتی وقتی سافاری بسته است معامله می‌کند. کلید خصوصی هیچ‌وقت داخل مخزن، لاگ، یا پیام ایجنت نوشته نمی‌شود.

روی اوبونتو ۲۲.۰۴ یا ۲۴.۰۴:

```bash
sudo bash server/install.sh
```

بار اول حالت آزمایشی است (`SMS_DRY_RUN=1`): تصمیم‌ها لاگ می‌شوند و تراکنشی فرستاده نمی‌شود.

کلید را یکی از این دو راه بدهید.

۱. صفحهٔ محلی. از لپ‌تاپ:

```bash
ssh -L 8788:127.0.0.1:8788 user@YOUR_VPS
```

بعد در مرورگر `http://127.0.0.1:8788` را باز کنید. فقط از خود سرور و از راه تونل باز می‌شود. کلید برنر، یک عبارت عبور (حداقل ۸ حرف) و توکن API (حداقل ۱۲ حرف) را وارد کنید. کلید با AES-256-GCM رمز می‌شود و در `/var/lib/sms/key.enc` می‌ماند.

۲. فایل با دسترسی فقط مالک:

```bash
sudo install -m 600 /dev/stdin /etc/sms/key
sudo install -m 600 /dev/stdin /etc/sms/passphrase
sudo systemctl restart sms-daemon
```

بعد از رمز شدن، فایل خام کلید پاک می‌شود. راه‌اندازی بعدی عبارت عبور را از `/etc/sms/passphrase` می‌خواند.

معاملهٔ واقعی: در `/etc/sms/sms.env` مقدار `SMS_DRY_RUN=0` را بگذارید و سرویس را ری‌استارت کنید. حالت‌ها پیش‌فرض خاموش‌اند. از کارت Server mode در پنل روشن‌شان کنید.

در پنل، آدرس `http://YOUR_VPS:8787` و توکن را ذخیره کنید و Use the server را بزنید. تا وقتی این حالت روشن است، خود مرورگر خرید نمی‌زند تا دو بار خرید نشود. دکمهٔ Pause all همهٔ خرید و فروش خودکار را نگه می‌دارد. پوزیشن‌ها روی زنجیره می‌مانند تا Resume.

دفتر اسکالپ و دجن، پوزیشن‌ها و فهرست سیاه در `/var/lib/sms/book.json` ذخیره می‌شوند و بعد از ری‌استارت سر جایشان هستند.
