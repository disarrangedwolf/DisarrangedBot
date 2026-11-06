# Deploying on a Linux server (Ubuntu/Debian)

Use a **subdomain** such as `bot.yourdomain.com` for the dashboard and link to it from your main website.
(The bot is a long-running Node program, so it can't live on shared web hosting such as cPanel, Wix or WordPress hosting. It needs a VPS or similar.)

## 1. DNS
Add an **A record**: `bot` pointing at your server's IP address.

## 2. Install Node and create a user
```
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs build-essential
sudo useradd --system --create-home --shell /usr/sbin/nologin discordbot
```

## 3. Put the bot on the server
```
sudo mkdir -p /opt/all-in-one-bot
# upload and unzip the bot into /opt/all-in-one-bot, then:
cd /opt/all-in-one-bot
sudo cp .env.example .env
sudo nano .env        # fill in the values below
sudo chmod 600 .env
sudo chown -R discordbot:discordbot /opt/all-in-one-bot
sudo -u discordbot npm install --omit=dev
```

`.env` values for a public dashboard:
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

## 4. Run it as a service (starts on boot, restarts if it crashes)
```
sudo cp deploy/all-in-one-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now all-in-one-bot
sudo journalctl -u all-in-one-bot -f     # live logs; Ctrl+C to leave
```
You should see "Dashboard ready at https://bot.yourdomain.com".

## 5. HTTPS reverse proxy (Caddy, easiest)
```
sudo apt install -y caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile     # edit the domain first
sudo systemctl reload caddy
```
(`deploy/nginx.conf` is there if you already use nginx.)

## 6. Firewall: expose only SSH and web
```
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
```
Do **not** open port 3000. It only listens on 127.0.0.1, and the proxy talks to it.

## 7. Discord Developer Portal
- OAuth2, Redirects: add `https://bot.yourdomain.com/callback` (exactly, no trailing slash).
- Bot tab: turn on Server Members Intent and Message Content Intent, and turn **Public Bot** on if other people will add it.

## 8. Backups
Everything is in `/opt/all-in-one-bot/bot.db`. Daily backup:
```
sudo apt install -y sqlite3
sudo crontab -u discordbot -e
# add:
0 4 * * * sqlite3 /opt/all-in-one-bot/bot.db ".backup '/opt/all-in-one-bot/backup-$(date +\%a).db'"
```
Copy those files off the server now and then.

## Updating
```
sudo systemctl stop all-in-one-bot
# replace the code files; keep .env and bot.db
cd /opt/all-in-one-bot && sudo -u discordbot npm install --omit=dev
sudo systemctl start all-in-one-bot
```

## Linking from your website
Add a normal link to `https://bot.yourdomain.com` (for example "Add to Discord" or "Dashboard") in your site's menu. `https://bot.yourdomain.com/healthz` returns `ok` for uptime monitors.
