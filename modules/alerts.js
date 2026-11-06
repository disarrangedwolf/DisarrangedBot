const { SlashCommandBuilder, PermissionFlagsBits: P, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { db } = require('../db');
const { EPH, pingOf, fmtText } = require('../utils');
const { get, getJson } = require('../net');
const { resolveYouTube } = require('../net');
const { fetchFeed } = require('../rss');

db.exec(`CREATE TABLE IF NOT EXISTS live_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, platform TEXT, username TEXT, display TEXT, avatar TEXT,
  channel_id TEXT, role_id TEXT, message TEXT, is_live INTEGER DEFAULT 0, stream_key TEXT, msg_id TEXT, off_count INTEGER DEFAULT 0,
  UNIQUE (guild_id, platform, username))`);

const PLATFORMS = {
  twitch: { name: 'Twitch', color: 0x9146ff, channelUrl: (r) => `https://twitch.tv/${r.username}` },
  kick: { name: 'Kick', color: 0x53fc18, channelUrl: (r) => `https://kick.com/${r.username}` },
  youtube: { name: 'YouTube', color: 0xff0000, channelUrl: (r) => `https://www.youtube.com/channel/${r.username}` },
};
const DEFAULT_MSG = '🔴 **{name}** is live on {platform}!';

// ---------- API access ----------
const tok = {};
async function token(kind) {
  const t = tok[kind];
  if (t && t.exp > Date.now() + 60000) return t.value;
  const cfg = kind === 'twitch'
    ? { url: 'https://id.twitch.tv/oauth2/token', id: process.env.TWITCH_CLIENT_ID, secret: process.env.TWITCH_CLIENT_SECRET }
    : { url: 'https://id.kick.com/oauth/token', id: process.env.KICK_CLIENT_ID, secret: process.env.KICK_CLIENT_SECRET };
  if (!cfg.id || !cfg.secret) throw new Error(`${PLATFORMS[kind].name} credentials are missing from the bot's .env file.`);
  const r = await getJson(cfg.url, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.id, client_secret: cfg.secret, grant_type: 'client_credentials' }),
  });
  tok[kind] = { value: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 };
  return tok[kind].value;
}
async function api(kind, url, retry = true) {
  const headers = { Authorization: `Bearer ${await token(kind)}` };
  if (kind === 'twitch') headers['Client-Id'] = process.env.TWITCH_CLIENT_ID;
  const res = await get(url, { headers });
  if (res.status === 401 && retry) { delete tok[kind]; return api(kind, url, false); }
  if (!res.ok) throw new Error(`${PLATFORMS[kind].name} API returned ${res.status}`);
  return res.json();
}

// Each fetcher returns a status object when live, or null when offline.
async function twitchStatuses(rows) {
  const out = new Map();
  const logins = [...new Set(rows.map((r) => r.username))];
  for (let n = 0; n < logins.length; n += 100) {
    const chunk = logins.slice(n, n + 100);
    const j = await api('twitch', `https://api.twitch.tv/helix/streams?first=100&${chunk.map((l) => `user_login=${encodeURIComponent(l)}`).join('&')}`);
    const live = new Map(j.data.filter((s) => s.type === 'live').map((s) => [s.user_login.toLowerCase(), s]));
    for (const l of chunk) {
      const s = live.get(l);
      out.set(l, s ? {
        key: s.id, title: s.title, game: s.game_name, viewers: s.viewer_count, name: s.user_name, url: `https://twitch.tv/${s.user_login}`,
        image: `${s.thumbnail_url.replace('{width}', '1280').replace('{height}', '720')}?t=${Date.now()}`,
      } : null);
    }
  }
  return out;
}
async function kickStatus(slug) {
  const j = await api('kick', `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`);
  const c = j.data?.[0];
  if (!c?.stream?.is_live) return null;
  const s = c.stream;
  // Kick has no stream id, so a stream is identified by its start time
  return { key: s.start_time || s.started_at || 'live', title: c.stream_title, game: c.category?.name, viewers: s.viewer_count, name: slug, url: `https://kick.com/${slug}`, image: s.thumbnail };
}
async function youtubeStatus(row) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY is not set.');
  const feed = await fetchFeed(`https://www.youtube.com/feeds/videos.xml?channel_id=${row.username}`);
  const ids = feed.entries.slice(0, 5).map((e) => e.id);
  if (!ids.length) return null;
  const j = await getJson(`https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${ids.join(',')}&key=${key}`);
  const v = j.items?.find((x) => x.liveStreamingDetails?.actualStartTime && !x.liveStreamingDetails?.actualEndTime);
  if (!v) return null;
  const th = v.snippet.thumbnails;
  return { key: v.id, title: v.snippet.title, game: null, viewers: v.liveStreamingDetails.concurrentViewers, name: v.snippet.channelTitle,
    url: `https://www.youtube.com/watch?v=${v.id}`, image: (th.maxres || th.high || th.default).url };
}

// ---------- announcing ----------
async function announce(client, row, st) {
  const ch = await client.channels.fetch(row.channel_id).catch(() => null);
  if (!ch) return null;
  const p = PLATFORMS[row.platform];
  const name = st.name || row.display || row.username;
  const embed = new EmbedBuilder().setColor(p.color).setAuthor({ name: `${name} is now live on ${p.name}!`, iconURL: row.avatar || undefined })
    .setTitle((st.title || 'Live now').slice(0, 256)).setURL(st.url).setTimestamp();
  if (st.game) embed.addFields({ name: 'Category', value: st.game, inline: true });
  if (st.viewers != null) embed.addFields({ name: 'Viewers', value: String(st.viewers), inline: true });
  if (st.image) embed.setImage(st.image);
  const ping = pingOf(row.guild_id, row.role_id);
  const body = fmtText(row.message || DEFAULT_MSG, { name, title: st.title || '', game: st.game || '', url: st.url, platform: p.name });
  const msg = await ch.send({
    content: `${ping.text ? `${ping.text} ` : ''}${body}`.slice(0, 2000), embeds: [embed], allowedMentions: ping.allowed,
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Watch now').setStyle(ButtonStyle.Link).setURL(st.url))],
  }).catch(() => null);
  return msg?.id || null;
}
async function markEnded(client, row) {
  if (!row.msg_id) return;
  const ch = await client.channels.fetch(row.channel_id).catch(() => null);
  const msg = ch && await ch.messages.fetch(row.msg_id).catch(() => null);
  if (!msg?.embeds[0]) return;
  const p = PLATFORMS[row.platform];
  msg.edit({
    embeds: [EmbedBuilder.from(msg.embeds[0]).setColor(0x95a5a6).setAuthor({ name: `${row.display || row.username} was live on ${p.name}` }).setFooter({ text: 'Stream ended' })],
    components: [],
  }).catch(() => {});
}

async function handle(client, row, st) {
  if (st) {
    if (!row.is_live || row.stream_key !== st.key) {
      const msgId = await announce(client, row, st);
      db.prepare('UPDATE live_alerts SET is_live = 1, stream_key = ?, msg_id = ?, off_count = 0 WHERE id = ?').run(st.key, msgId, row.id);
    } else if (row.off_count) {
      db.prepare('UPDATE live_alerts SET off_count = 0 WHERE id = ?').run(row.id);
    }
  } else if (row.is_live) {
    // require several consecutive "offline" polls so a brief API blip doesn't end the alert
    if (row.off_count + 1 >= 3) {
      db.prepare('UPDATE live_alerts SET is_live = 0, off_count = 0 WHERE id = ?').run(row.id);
      markEnded(client, row);
    } else db.prepare('UPDATE live_alerts SET off_count = off_count + 1 WHERE id = ?').run(row.id);
  }
}

let tick = 0;
async function poll(client) {
  const rows = db.prepare('SELECT * FROM live_alerts').all();
  if (!rows.length) return;
  const results = new Map(); // row id -> status | null, only for rows we checked successfully
  const by = (p) => rows.filter((r) => r.platform === p);

  if (by('twitch').length) {
    try { const m = await twitchStatuses(by('twitch')); for (const r of by('twitch')) results.set(r.id, m.get(r.username) ?? null); }
    catch (e) { console.error('[live] twitch:', e.message); }
  }
  const kickCache = new Map(); // same streamer tracked in several servers = one API call
  for (const r of by('kick')) {
    try {
      if (!kickCache.has(r.username)) kickCache.set(r.username, await kickStatus(r.username));
      results.set(r.id, kickCache.get(r.username));
    } catch (e) { console.error('[live] kick:', e.message); }
  }
  if (tick % 5 === 0) { // YouTube costs API quota, so check every 5 minutes
    const ytCache = new Map();
    for (const r of by('youtube')) {
      try {
        if (!ytCache.has(r.username)) ytCache.set(r.username, await youtubeStatus(r));
        results.set(r.id, ytCache.get(r.username));
      } catch (e) { console.error('[live] youtube:', e.message); }
    }
  }
  tick++;
  for (const r of rows) if (results.has(r.id)) await handle(client, r, results.get(r.id)).catch((e) => console.error('[live]', e));
}

const MAX_ALERTS = 15;
// Validates a streamer and saves the alert. Throws Error with a user-friendly message. Returns the display name.
async function addAlert(guildId, { platform, username, channelId, roleId, message }) {
  if (!PLATFORMS[platform]) throw new Error('Unknown platform.');
  if (db.prepare('SELECT COUNT(*) AS c FROM live_alerts WHERE guild_id = ?').get(guildId).c >= MAX_ALERTS) throw new Error(`Each server can track up to ${MAX_ALERTS} streamers.`);
  username = String(username || '').trim();
  if (!username) throw new Error('Enter a username.');
  let display = username; let avatar = null;
  if (platform === 'twitch') {
    username = username.replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').replace(/[/?#].*$/, '').toLowerCase();
    const u = (await api('twitch', `https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`)).data?.[0];
    if (!u) throw new Error('Twitch user not found.');
    display = u.display_name; avatar = u.profile_image_url;
  } else if (platform === 'kick') {
    username = username.replace(/^https?:\/\/(www\.)?kick\.com\//i, '').replace(/[/?#].*$/, '').toLowerCase();
    const c = (await api('kick', `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(username)}`).catch(() => { throw new Error("Couldn't find that Kick channel."); })).data?.[0];
    if (!c) throw new Error("Couldn't find that Kick channel.");
    display = c.slug || username;
  } else {
    if (!process.env.YOUTUBE_API_KEY) throw new Error("YouTube live detection needs YOUTUBE_API_KEY in the bot's .env file. (For new-upload posts without a key, use Feeds.)");
    const r = await resolveYouTube(username);
    username = r.id;
    const f = await fetchFeed(`https://www.youtube.com/feeds/videos.xml?channel_id=${r.id}`).catch(() => null);
    display = r.name || f?.title || r.id;
  }
  db.prepare(`INSERT INTO live_alerts (guild_id, platform, username, display, avatar, channel_id, role_id, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, platform, username) DO UPDATE SET channel_id = excluded.channel_id, role_id = excluded.role_id, message = excluded.message, display = excluded.display, avatar = excluded.avatar`)
    .run(guildId, platform, username, display, avatar, channelId, roleId || null, message || null);
  return display;
}

let polling = false;
const guarded = async (client) => {
  if (polling) return; // never let slow polls pile up
  polling = true;
  try { await poll(client); } finally { polling = false; }
};

// ---------- command ----------
module.exports = {
  api: { addAlert },
  init(client) {
    setTimeout(() => guarded(client).catch(console.error), 10000);
    setInterval(() => guarded(client).catch(console.error), 60000);
  },
  commands: [{
    data: new SlashCommandBuilder().setName('live').setDescription('Go-live alerts for Twitch, Kick and YouTube').setDefaultMemberPermissions(P.ManageGuild)
      .addSubcommand((s) => s.setName('add').setDescription('Announce when a streamer goes live')
        .addStringOption((o) => o.setName('platform').setDescription('Platform').setRequired(true).addChoices({ name: 'Twitch', value: 'twitch' }, { name: 'Kick', value: 'kick' }, { name: 'YouTube', value: 'youtube' }))
        .addStringOption((o) => o.setName('username').setDescription('Username, channel URL, or YouTube @handle').setRequired(true))
        .addChannelOption((o) => o.setName('channel').setDescription('Where to announce').setRequired(true))
        .addRoleOption((o) => o.setName('ping').setDescription('Role to ping (@everyone works too)'))
        .addStringOption((o) => o.setName('message').setDescription('Custom text. Use {name} {title} {game} {url} {platform}')))
      .addSubcommand((s) => s.setName('remove').setDescription('Stop tracking a streamer')
        .addStringOption((o) => o.setName('platform').setDescription('Platform').setRequired(true).addChoices({ name: 'Twitch', value: 'twitch' }, { name: 'Kick', value: 'kick' }, { name: 'YouTube', value: 'youtube' }))
        .addStringOption((o) => o.setName('username').setDescription('Username or channel name').setRequired(true)))
      .addSubcommand((s) => s.setName('list').setDescription('List tracked streamers')),
    async execute(i) {
      const g = i.guildId; const sub = i.options.getSubcommand();
      if (sub === 'list') {
        const rows = db.prepare('SELECT * FROM live_alerts WHERE guild_id = ?').all(g);
        const text = rows.map((r) => `${r.is_live ? '🔴' : '⚫'} **${r.display || r.username}** (${PLATFORMS[r.platform].name}) → <#${r.channel_id}>${r.role_id ? ` • ping <@&${r.role_id}>` : ''}`).join('\n');
        return i.reply({ embeds: [new EmbedBuilder().setTitle('Live alerts').setDescription(text || 'Nothing tracked yet. Use `/live add`.')], flags: EPH });
      }
      const platform = i.options.getString('platform');
      let username = i.options.getString('username').trim();
      if (sub === 'remove') {
        const clean = username.toLowerCase();
        const r = db.prepare('DELETE FROM live_alerts WHERE guild_id = ? AND platform = ? AND (lower(username) = ? OR lower(display) = ?)').run(g, platform, clean, clean);
        return i.reply({ content: r.changes ? '🗑️ Removed.' : 'No matching streamer found. Try `/live list`.', flags: EPH });
      }

      await i.deferReply({ flags: EPH });
      try {
        const ch = i.options.getChannel('channel');
        const display = await addAlert(g, { platform, username, channelId: ch.id, roleId: i.options.getRole('ping')?.id || null, message: i.options.getString('message') });
        i.editReply(`✅ I'll post in ${ch} when **${display}** goes live on ${PLATFORMS[platform].name}. Checks run every minute (every 5 for YouTube).`);
      } catch (e) { i.editReply(`❌ ${e.message}`); }
    },
  }],
};
