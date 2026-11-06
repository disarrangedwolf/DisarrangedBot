# Deploying on a Windows server

Use a **subdomain** such as `bot.yourdomain.com` for the dashboard and link to it from your main website.
Run everything below in an **Administrator PowerShell**.

## 1. DNS and ports
- Add an **A record**: `bot` pointing at the server's public IP.
- Ports **80 and 443** must reach the server (cloud firewall / security group, or router port forwarding).
- Never expose port 3000. The dashboard only listens on `127.0.0.1`, and the reverse proxy talks to it.

## 2. Install Node.js 22 LTS
Download the **Node 22 LTS** installer from nodejs.org. Check with `node -v`.
Stick to the LTS version: newer ones often have no prebuilt copy of the database library, which forces a slow compile that needs Visual Studio Build Tools.

## 3. Put the bot on the server
```
mkdir C:\bots
# unzip the bot so you have C:\bots\all-in-one-bot\index.js
cd C:\bots\all-in-one-bot
copy .env.example .env
notepad .env
npm install --omit=dev
```
Values for a public dashboard in `.env`:
```
DISCORD_TOKEN=...
GUILD_ID=
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
WEB_BASE_URL=https://bot.yourdomain.com
WEB_PORT=3000
WEB_HOST=127.0.0.1
WEB_TRUST_PROXY=1
```
Lock the file down so only administrators and the system can read it:
```
icacls .env /inheritance:r /grant:r "SYSTEM:(R)" "Administrators:(R)"
```
Test it once with `npm start`. You should see "Dashboard ready at https://bot.yourdomain.com". Stop it with Ctrl+C.

## 4. Run the bot as a Windows service
Download **NSSM** from nssm.cc (unzip `win64\nssm.exe` somewhere on your PATH, e.g. `C:\Windows`). Then:
```
mkdir C:\bots\all-in-one-bot\logs
nssm install AllInOneBot "C:\Program Files\nodejs\node.exe" index.js
nssm set AllInOneBot AppDirectory C:\bots\all-in-one-bot
nssm set AllInOneBot Start SERVICE_AUTO_START
nssm set AllInOneBot AppExit Default Restart
nssm set AllInOneBot AppRestartDelay 5000
nssm set AllInOneBot AppStdout C:\bots\all-in-one-bot\logs\out.log
nssm set AllInOneBot AppStderr C:\bots\all-in-one-bot\logs\err.log
nssm set AllInOneBot AppRotateFiles 1
nssm set AllInOneBot AppRotateBytes 5000000
nssm start AllInOneBot
```
It now starts on boot and restarts if it crashes. Read logs in `logs\out.log` and `logs\err.log`.

## 5. HTTPS reverse proxy. Pick ONE.

### Option A: Caddy (use this if nothing else is using ports 80/443)
1. Download `caddy.exe` for Windows from caddyserver.com/download into `C:\caddy\`.
2. Copy `deploy\Caddyfile` to `C:\caddy\Caddyfile` and change the domain.
3. Run it as a service:
```
nssm install Caddy C:\caddy\caddy.exe run --config C:\caddy\Caddyfile --adapter caddyfile
nssm set Caddy AppDirectory C:\caddy
nssm set Caddy Start SERVICE_AUTO_START
nssm start Caddy
```
Caddy gets and renews the HTTPS certificate by itself.

### Option B: IIS (use this if your website already runs on IIS)
1. Install the IIS role if needed, plus **URL Rewrite** and **Application Request Routing 3.0** (both from iis.net).
2. IIS Manager, your server, **Application Request Routing Cache**, **Server Proxy Settings**: tick **Enable proxy**.
3. Create a new site named `bot` with a binding for host name `bot.yourdomain.com` on port 80, pointing at an empty folder such as `C:\inetpub\bot`. Copy `deploy\web.config` into that folder.
4. Get a free certificate with **win-acme** (win-acme.com): run `wacs.exe`, choose the `bot` site, and it installs the certificate and renews it automatically.

## 6. Windows Firewall
```
New-NetFirewallRule -DisplayName "Web 80/443" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow
```

## 7. Discord Developer Portal
- OAuth2, Redirects: add `https://bot.yourdomain.com/callback` (exactly, no trailing slash).
- Bot tab: turn on Server Members Intent and Message Content Intent, and turn **Public Bot** on if other people will add it.

## 8. Daily backup
Everything is in `bot.db`. `npm run backup` makes a safe copy in `backups\` (works while the bot runs) and keeps 14 days. Schedule it:
```
schtasks /Create /SC DAILY /ST 04:00 /TN "BotBackup" /RU SYSTEM /TR "\"C:\Program Files\nodejs\node.exe\" C:\bots\all-in-one-bot\backup.js"
```
Copy the `backups` folder off the server now and then.

## Updating
```
nssm stop AllInOneBot
# replace the code files; KEEP .env and bot.db
cd C:\bots\all-in-one-bot
npm install --omit=dev
nssm start AllInOneBot
```

## Linking from your website
Add a normal link to `https://bot.yourdomain.com` in your site's menu. `https://bot.yourdomain.com/healthz` returns `ok` for uptime monitors.
