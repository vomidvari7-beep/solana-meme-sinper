# دیمون SolanaMemeSniper

پنل روی HTTPS است. آیفون به `http://IP:8787` وصل نمی‌شود. نصب، Caddy را با گواهی خودکار راه می‌اندازد و فقط `/api/*` را به `127.0.0.1:8787` می‌فرستد. خود دیمون روی اینترنت باز نیست.

## از آیفون، بدون تونل SSH

1. یک VPS با اوبونتو ۲۲.۰۴ یا ۲۴.۰۴ بخر. پورت‌های ۲۲، ۸۰ و ۴۴۳ را باز بگذار.
2. کنسول وب همان VPS را باز کن، یا در Termius به آن SSH بزن.
3. این یک خط را بچسبان:

```bash
curl -fsSL https://raw.githubusercontent.com/vomidvari7-beep/solana-meme-sinper/main/server/install.sh | sudo bash
```

4. آخر خروجی سه خط است: آدرس `https://…`، توکن API، و لینک یک‌بارمصرف setup. لینک را در سافاری باز کن.
5. کلید خصوصی برنر و یک عبارت عبور (حداقل ۸ حرف) را وارد کن. کد راه‌اندازی از خود لینک پر شده است. صفحه ۳۰ دقیقه اعتبار دارد، بعد از چند تلاش اشتباه قفل می‌شود، و بعد از ذخیرهٔ کلید برای همیشه بسته می‌شود. کلید در لاگ و در مخزن نوشته نمی‌شود.
6. در پنل، Wallet & Trading و Server mode: همان آدرس `https://` (بدون پورت و بدون `/api`) و توکن را بگذار و Use the server را روشن کن. تا وقتی این حالت روشن است خود مرورگر معامله نمی‌کند.

اگر دامنهٔ خودت را می‌خواهی، قبل از نصب این را بزن و DNS را به IP سرور اشاره بده:

```bash
echo bot.example.com | sudo tee /etc/sms/domain
```

بدون این فایل، آدرس به شکل `1-2-3-4.sslip.io` ساخته می‌شود.

بار اول معامله واقعی نمی‌فرستد (`SMS_DRY_RUN=1`). وقتی خواستی واقعی شود، در `/etc/sms/sms.env` مقدار را `0` کن و `sudo systemctl restart sms-daemon` بزن. حالت‌های اسکالپ، بریک‌اوت، پلن و دجن پیش‌فرض خاموش‌اند و از پنل روشن می‌شوند. دکمهٔ Pause all خرید و فروش خودکار را نگه می‌دارد.

اگر ۳۰ دقیقه گذشت و هنوز کلید را نفرستادی، همان دستور curl را دوباره اجرا کن تا لینک تازه ساخته شود.

راه جایگزین، اگر کنسول فایل می‌پذیرد: کلید را در `/etc/sms/key` و عبارت عبور را در `/etc/sms/passphrase` بگذار، هر دو با `chmod 600`. دیمون کلید را رمز می‌کند و فایل خام را پاک می‌کند.

دفترها، پوزیشن‌ها و فهرست سیاه در `/var/lib/sms/book.json` می‌مانند.

## English

GitHub Pages is HTTPS, so iOS Safari blocks `http://VPS:8787`. install.sh installs Caddy, gets a certificate for `<public-ip-with-dashes>.sslip.io` (or `SMS_DOMAIN` / `/etc/sms/domain`), and reverse-proxies only `/api/*` to `127.0.0.1:8787`. The setup page is `https://<host>/setup`. CORS allows only `https://vomidvari7-beep.github.io`.

iPhone flow: buy an Ubuntu 22.04/24.04 VPS with ports 22, 80, and 443 open. Open its web console or Termius and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/vomidvari7-beep/solana-meme-sinper/main/server/install.sh | sudo bash
```

Open the printed `https://…/setup#…` link in Safari within 30 minutes. Enter the burner secret and a passphrase. The setup code is filled from the link, attempts are rate-limited, and the page is disabled forever after the key is encrypted. The API token is printed once in that console output. Paste the https origin (no port, no `/api`) and the token into Server mode.

The daemon still starts in dry-run. Set `SMS_DRY_RUN=0` and restart when you want live swaps. Trading rules match the panel: Scalp ledger at $100 with 50% then the remainder, dynamic +5% trail, -$20 day stop; My List chart stops; agent plans at confidence 60 on a trigger touch; Live Degen ledger and tiered exits; fake-data skips and the rug blacklist.
