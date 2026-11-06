const express = require('express');
const crypto = require('crypto');
const { PermissionFlagsBits: P, EmbedBuilder } = require('discord.js');
const { db } = require('../db');
const { getJson } = require('../net');
const { inviteUrl, log } = require('../utils');
const ui = require('./ui');
const { PAGES, ORDER, UserError, buildCtx } = require('./pages');

db.exec('CREATE TABLE IF NOT EXISTS web_sessions (id TEXT PRIMARY KEY, user_id TEXT, username TEXT, avatar TEXT, guilds TEXT, csrf TEXT, expires INTEGER)');

const WEEK = 7 * 864e5;
const rand = (n = 32) => crypto.randomBytes(n).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex'); // only a hash of the session id is stored
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const safeDecode = (v) => { try { return decodeURIComponent(v); } catch { return ''; } };
const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, safeDecode(v.join('='))]));
const manageable = (g) => g.owner || (BigInt(g.permissions) & 0x28n) !== 0n; // Manage Server or Administrator

function start(client) {
  const { DISCORD_CLIENT_ID: cid, DISCORD_CLIENT_SECRET: secret, WEB_BASE_URL } = process.env;
  if (!cid || !secret || !WEB_BASE_URL) {
    console.log('[web] Dashboard is off. Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and WEB_BASE_URL in .env to turn it on.');
    return;
  }
  const base = WEB_BASE_URL.replace(/\/$/, '');
  const secure = base.startsWith('https://');
  const port = Number(process.env.WEB_PORT || 3000);
  const host = process.env.WEB_HOST || '127.0.0.1';
  const redirectUri = `${base}/callback`;

  const sessions = {
    create(user, guilds) {
      const id = rand(32);
      db.prepare('INSERT INTO web_sessions VALUES (?, ?, ?, ?, ?, ?, ?)').run(sha(id), user.id, user.global_name || user.username, user.avatar || null, JSON.stringify(guilds), rand(16), Date.now() + WEEK);
      return id;
    },
    get(id) {
      if (!id) return null;
      const r = db.prepare('SELECT * FROM web_sessions WHERE id = ? AND expires > ?').get(sha(id), Date.now());
      return r ? { ...r, guilds: JSON.parse(r.guilds) } : null;
    },
    destroy: (id) => id && db.prepare('DELETE FROM web_sessions WHERE id = ?').run(sha(id)),
  };
  setInterval(() => db.prepare('DELETE FROM web_sessions WHERE expires < ?').run(Date.now()), 36e5);

  const cookie = (name, val, maxAge) => `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  const botName = () => client.user.username;
  const userOf = (req) => (req.session ? { id: req.session.user_id, username: req.session.username, avatar: req.session.avatar } : null);
  const html = (req, res, { title, body, status = 200 }) =>
    res.status(status).type('html').send(ui.layout({ title, body, user: userOf(req), csrf: req.session?.csrf || '', botName: botName() }));
  const errorPage = (req, res, status, title, msg) => html(req, res, {
    title, status, body: `<div class="wrap page"><h1>${ui.esc(title)}</h1><p class="sub">${ui.esc(msg)}</p><a class="btn" href="/dashboard">Back to your servers</a></div>`,
  });
  const csrfOk = (req) => {
    const a = Buffer.from(String(req.body?._csrf || '')); const b = Buffer.from(req.session?.csrf || '');
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const iconHtml = (g) => `<span class="icon">${g.icon ? `<img src="https://cdn.discordapp.com/icons/${ui.esc(g.id)}/${ui.esc(g.icon)}.png?size=64" alt="">` : ui.esc([...(g.name || '?')][0].toUpperCase())}</span>`;

  const app = express();
  app.disable('x-powered-by');
  if (process.env.WEB_TRUST_PROXY) app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https://cdn.discordapp.com data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    next();
  });
  app.get('/healthz', (req, res) => res.type('text').send('ok')); // for uptime monitors
  const hits = new Map();
  app.use((req, res, next) => {
    const now = Date.now(); let h = hits.get(req.ip);
    if (!h || h.reset < now) { h = { n: 0, reset: now + 60000 }; hits.set(req.ip, h); }
    if (++h.n > 240) return res.status(429).type('text').send('Too many requests. Wait a minute and try again.');
    next();
  });
  setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.reset < now) hits.delete(k); }, 60000);
  app.use((req, res, next) => { req.cookies = parseCookies(req.headers.cookie); req.session = sessions.get(req.cookies.sid); next(); });
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  // ---------- landing ----------
  app.get('/', (req, res) => html(req, res, {
    title: botName(),
    body: `<section class="hero"><div class="wrap"><h1>One bot instead of fifteen.</h1>
<p class="lead">Moderation, tickets, levels, stream alerts, social feeds and backups, set up per server from one control panel.</p>
<ul class="roster"><li><s>Moderation bot</s></li><li><s>Ticket bot</s></li><li><s>Counting bot</s></li><li><s>Stream alert bot</s></li><li><s>Backup bot</s></li><li><s>Server stats bot</s></li><li><s>Feeds bot</s></li><li class="live">${ui.esc(botName())}</li></ul>
<div class="cta"><a class="btn" href="${ui.esc(inviteUrl(client))}">Add to Discord</a><a class="btn ghost" href="/dashboard">Open the dashboard</a></div></div></section>
<div class="wrap"><dl class="facts">
<dt>Moderation</dt><dd>Kick, ban, timeouts, warnings, AutoMod, anti-raid, anti-nuke and a honeypot channel.</dd>
<dt>Tickets</dt><dd>Several ticket types, questions before opening, claiming, priorities, transcripts and ratings.</dd>
<dt>Live alerts</dt><dd>Announce when people go live on Twitch, Kick and YouTube.</dd>
<dt>Social feeds</dt><dd>New videos and posts from YouTube, Reddit, Bluesky, Mastodon, GitHub and any RSS feed.</dd>
<dt>Community</dt><dd>Levels, counting, starboard, suggestions, giveaways, tags and auto-replies.</dd>
<dt>Server tools</dt><dd>Backups, applications, verification, role panels, welcome messages and live stat channels.</dd></dl></div>`,
  }));

  // ---------- login ----------
  app.get('/login', (req, res) => {
    const state = rand(16);
    res.append('Set-Cookie', cookie('oauth_state', state, 600));
    res.redirect(`https://discord.com/oauth2/authorize?${new URLSearchParams({ client_id: cid, response_type: 'code', redirect_uri: redirectUri, scope: 'identify guilds', state, prompt: 'none' })}`);
  });

  app.get('/callback', wrap(async (req, res) => {
    const { code, state } = req.query;
    if (req.query.error) return errorPage(req, res, 400, 'Login cancelled', 'You cancelled the Discord login. Try again when you are ready.');
    if (!code || !state || state !== req.cookies.oauth_state) return errorPage(req, res, 400, 'Login expired', 'Start the login again from the Log in button.');
    let sid;
    let token;
    try {
      const t = await getJson('https://discord.com/api/v10/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: cid, client_secret: secret, grant_type: 'authorization_code', code: String(code), redirect_uri: redirectUri }),
      });
      token = t.access_token;
      const auth = { headers: { Authorization: `Bearer ${token}` } };
      const user = await getJson('https://discord.com/api/v10/users/@me', auth);
      const guilds = (await getJson('https://discord.com/api/v10/users/@me/guilds', auth)).map((g) => ({ id: g.id, name: g.name, icon: g.icon, owner: g.owner, permissions: String(g.permissions) }));
      sid = sessions.create(user, guilds);
    } catch (e) {
      console.error('[web] login failed:', e.message);
      return errorPage(req, res, 502, 'Discord rejected the login', `Check that ${redirectUri} is listed under Redirects in the Discord Developer Portal, and that the client ID and secret in .env are correct.`);
    } finally {
      if (token) fetch('https://discord.com/api/v10/oauth2/token/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cid, client_secret: secret, token }) }).catch(() => {});
    }
    res.append('Set-Cookie', cookie('sid', sid, WEEK / 1000));
    res.append('Set-Cookie', cookie('oauth_state', '', 0));
    res.redirect('/dashboard');
  }));

  app.post('/logout', (req, res) => {
    if (csrfOk(req)) { sessions.destroy(req.cookies.sid); res.append('Set-Cookie', cookie('sid', '', 0)); }
    res.redirect(303, '/');
  });

  // ---------- server list ----------
  app.get('/dashboard', (req, res) => {
    if (!req.session) return res.redirect('/login');
    const list = req.session.guilds.filter(manageable).map((g) => ({ ...g, here: client.guilds.cache.has(g.id) })).sort((a, b) => b.here - a.here || a.name.localeCompare(b.name));
    const items = list.map((g) => `<li>${iconHtml(g)}<span class="name">${ui.esc(g.name)}</span>${g.here
      ? `<a class="btn small" href="/g/${ui.esc(g.id)}">Manage</a>`
      : `<a class="btn ghost small" href="${ui.esc(`${inviteUrl(client)}&guild_id=${g.id}&disable_guild_select=true`)}">Add bot</a>`}</li>`).join('');
    html(req, res, {
      title: 'Your servers',
      body: `<div class="wrap page"><h1>Your servers</h1><p class="sub">Servers where you have the Manage Server permission. Pick one to set it up, or add the bot to a server it isn't in yet.</p>
${items ? `<ul class="servers">${items}</ul>` : '<p class="empty">You do not manage any servers. Ask a server admin for the Manage Server permission.</p>'}
<p class="sub">Not listed? Log out and back in to refresh the list.</p></div>`,
    });
  });

  // ---------- per-server pages ----------
  const guildAuth = wrap(async (req, res, next) => {
    if (!req.session) return res.redirect('/login');
    const id = req.params.id;
    if (!/^\d{15,25}$/.test(id)) return errorPage(req, res, 404, 'Not found', 'That server does not exist.');
    const guild = client.guilds.cache.get(id);
    if (!guild) return errorPage(req, res, 404, 'The bot is not in that server', 'Add it from the server list first.');
    // checked against live permissions, not whatever the login saw
    let allowed = guild.ownerId === req.session.user_id;
    if (!allowed) { const m = await guild.members.fetch(req.session.user_id).catch(() => null); allowed = !!m && m.permissions.has(P.ManageGuild); }
    if (!allowed) return errorPage(req, res, 403, 'No access', 'You need the Manage Server permission in that server.');
    req.guild = guild;
    next();
  });

  app.get('/g/:id/:page?', guildAuth, wrap(async (req, res) => {
    const page = PAGES[req.params.page || 'overview'];
    if (!page) return errorPage(req, res, 404, 'Not found', 'That page does not exist.');
    const g = req.guild; const ctx = buildCtx(g, req.session.csrf);
    const flash = req.query.ok ? `<p class="note ok" role="status">${ui.esc(String(req.query.ok).slice(0, 300))}</p>`
      : req.query.err ? `<p class="note err" role="alert">${ui.esc(String(req.query.err).slice(0, 300))}</p>` : '';
    const nav = ORDER.map((id) => `<a href="/g/${g.id}/${id}"${id === page.id ? ' aria-current="page"' : ''}>${ui.esc(PAGES[id].title)}</a>`).join('');
    html(req, res, {
      title: `${page.title} - ${g.name}`,
      body: `<div class="shell"><aside class="side"><h2>${iconHtml({ id: g.id, name: g.name, icon: g.icon })}${ui.esc(g.name)}</h2><nav>${nav}</nav><nav class="all"><a href="/dashboard">All servers</a></nav></aside><main class="main">${flash}${await page.render(ctx)}</main></div>`,
    });
  }));

  app.post('/g/:id/:page', guildAuth, wrap(async (req, res) => {
    const page = PAGES[req.params.page];
    if (!page) return errorPage(req, res, 404, 'Not found', 'That page does not exist.');
    if (!csrfOk(req)) return errorPage(req, res, 403, 'Session expired', 'Reload the page and try again.');
    const back = (kind, msg) => res.redirect(303, `/g/${req.guild.id}/${page.id}?${kind}=${encodeURIComponent(msg)}`);
    const fn = page.actions?.[req.body.action];
    if (!fn) return back('err', 'That action is not available.');
    try {
      const msg = await fn(buildCtx(req.guild, req.session.csrf), req.body);
      log(req.guild, new EmbedBuilder().setColor(0x5865f2).setTitle('Dashboard change')
        .setDescription(`${req.session.username} updated **${page.title}** (${String(req.body.action).replace(/_/g, ' ')}) from the web dashboard.`).setTimestamp());
      back('ok', msg || 'Saved.');
    } catch (e) {
      if (e instanceof UserError) return back('err', e.message);
      console.error('[web]', e);
      back('err', 'Something went wrong. Check the bot console for details.');
    }
  }));

  app.use((req, res) => errorPage(req, res, 404, 'Not found', 'That page does not exist.'));
  app.use((err, req, res, next) => { console.error('[web]', err); if (res.headersSent) return next(err); errorPage(req, res, 500, 'Something went wrong', 'The error was logged. Try again in a moment.'); });

  const srv = app.listen(port, host, () => console.log(`[web] Dashboard ready at ${base} (listening on ${host}:${port})`));
  srv.on('error', (e) => console.error(`[web] could not start on ${host}:${port}: ${e.message}`));
}

module.exports = { start };
