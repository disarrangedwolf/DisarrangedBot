# All-in-one Discord bot

One bot for moderation, tickets, levels, live-stream alerts, social feeds, backups and more, with an optional web dashboard.

## Run the bot
1. `npm install` (Node 20 or newer; Node 22 LTS is safest on Windows)
2. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`. Leave `GUILD_ID` blank so it works in every server.
3. In the Discord Developer Portal, Bot tab: turn on **Server Members Intent** and **Message Content Intent**.
4. `npm start`. The console prints an invite link.

## Turn on the web dashboard
1. Developer Portal, OAuth2: copy the **Client ID** and **Client Secret** into `.env` (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`).
2. Under **Redirects**, add `<WEB_BASE_URL>/callback`. For local testing that is `http://localhost:3000/callback`.
3. Set `WEB_BASE_URL` in `.env` and restart. Open that address and log in with Discord.
4. To let other people add the bot, turn **Public Bot** on in the Bot tab.

Discord only accepts `http://` redirects for localhost. For a real domain you need HTTPS, which is easiest with a reverse proxy.
Example Caddyfile (Caddy gets the certificate automatically):

```
bot.example.com {
    reverse_proxy 127.0.0.1:3000
}
```
Then set `WEB_BASE_URL=https://bot.example.com` and `WEB_TRUST_PROXY=1`.

## Deploying on your own server
Windows: `deploy/DEPLOY-WINDOWS.md` (NSSM service, Caddy or IIS for HTTPS, firewall, scheduled backups).
Linux: `deploy/DEPLOY.md` (systemd service, Caddy or nginx for HTTPS, firewall, backups).

## Optional keys
Twitch, Kick and YouTube keys for live alerts, and an RSSHub address for X/TikTok/Instagram feeds, are listed in `.env.example`.

## Data
Everything is stored in `bot.db` (SQLite) next to the bot. Back it up.
