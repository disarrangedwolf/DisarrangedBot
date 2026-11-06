const { SlashCommandBuilder, PermissionFlagsBits: P, EmbedBuilder } = require('discord.js');
const { db } = require('../db');
const { EPH, pingOf, fmtText } = require('../utils');
const { getJson, isSafeUrl, resolveYouTube } = require('../net');
const { fetchFeed } = require('../rss');

db.exec(`
CREATE TABLE IF NOT EXISTS feeds (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, platform TEXT, target TEXT, display TEXT, url TEXT, channel_id TEXT, role_id TEXT, message TEXT);
CREATE TABLE IF NOT EXISTS feed_seen (feed_id INTEGER, item_id TEXT, PRIMARY KEY (feed_id, item_id));
`);

const PLATFORMS = {
  youtube: { name: 'YouTube', color: 0xff0000 }, rss: { name: 'RSS', color: 0xf39c12 }, reddit: { name: 'Reddit', color: 0xff4500 },
  bluesky: { name: 'Bluesky', color: 0x1185fe }, mastodon: { name: 'Mastodon', color: 0x6364ff }, github: { name: 'GitHub', color: 0x24292f },
  twitter: { name: 'X / Twitter', color: 0x1da1f2 }, tiktok: { name: 'TikTok', color: 0x010101 }, instagram: { name: 'Instagram', color: 0xe1306c },
};
const rsshub = () => (process.env.RSSHUB_URL || 'https://rsshub.app').replace(/\/$/, '');

// ---------- turn "platform + target" into something fetchable ----------
async function resolve(platform, input) {
  input = input.trim();
  switch (platform) {
    case 'youtube': {
      const r = await resolveYouTube(input);
      const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${r.id}`;
      const f = await fetchFeed(url);
      return { target: r.id, url, display: r.name || f.title || r.id };
    }
    case 'reddit': {
      const m = input.match(/(?:reddit\.com\/)?\/?(r|u|user)\/([\w-]+)/i);
      if (!m) throw new Error('Use `r/subreddit` or `u/username`.');
      const sub = m[1].toLowerCase() === 'r';
      return { target: `${sub ? 'r' : 'u'}/${m[2]}`, url: sub ? `https://www.reddit.com/r/${m[2]}/.rss` : `https://www.reddit.com/user/${m[2]}/submitted/.rss`, display: `${sub ? 'r' : 'u'}/${m[2]}` };
    }
    case 'bluesky': {
      const h = input.replace(/^https?:\/\/bsky\.app\/profile\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
      if (!h.includes('.')) throw new Error('Use a handle like `name.bsky.social`.');
      return { target: h, url: null, display: h };
    }
    case 'mastodon': {
      const m = input.match(/^@?([\w.-]+)@([\w.-]+\.[a-z]{2,})$/i) || input.match(/^https?:\/\/([\w.-]+)\/@([\w.-]+)/i);
      if (!m) throw new Error('Use `@user@instance.social` or a profile URL.');
      const [user, host] = input.startsWith('http') ? [m[2], m[1]] : [m[1], m[2]];
      return { target: `@${user}@${host}`, url: `https://${host}/@${user}.rss`, display: `@${user}@${host}` };
    }
    case 'github': {
      const m = input.match(/(?:github\.com\/)?([\w.-]+\/[\w.-]+)/);
      if (!m) throw new Error('Use `owner/repo`.');
      return { target: m[1], url: `https://github.com/${m[1]}/releases.atom`, display: `${m[1]} releases` };
    }
    case 'twitter': case 'tiktok': case 'instagram': {
      const name = input.replace(/^https?:\/\/[^/]+\//, '').replace(/^@/, '').replace(/[/?#].*$/, '');
      if (!name) throw new Error('Give a username.');
      const route = { twitter: `twitter/user/${name}`, tiktok: `tiktok/user/@${name}`, instagram: `instagram/user/${name}` }[platform];
      return { target: name, url: `${rsshub()}/${route}`, display: `@${name}` };
    }
    default: {
      if (!isSafeUrl(input)) throw new Error('Give a public http(s) feed URL.');
      return { target: input, url: input, display: null };
    }
  }
}

async function blueskyEntries(handle) {
  const j = await getJson(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=15&filter=posts_no_replies`);
  return j.feed.filter((f) => !f.reason).map((f) => { // skip reposts
    const p = f.post; const e = p.embed;
    return {
      id: p.uri, title: '', link: `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split('/').pop()}`,
      summary: p.record?.text || '', image: e?.images?.[0]?.fullsize || e?.thumbnail || e?.external?.thumb || null,
      published: Date.parse(p.record?.createdAt) || 0, author: p.author.displayName || p.author.handle, authorIcon: p.author.avatar,
    };
  });
}
// `cache` (optional) lets servers following the same account share one fetch per cycle
async function entriesFor(feed, cache) {
  const key = `${feed.platform}|${feed.url || feed.target}`;
  if (cache?.has(key)) return cache.get(key);
  const p = feed.platform === 'bluesky'
    ? blueskyEntries(feed.target).then((entries) => ({ title: feed.display, entries }))
    : fetchFeed(feed.url);
  cache?.set(key, p);
  return p;
}

// ---------- posting ----------
async function post(client, feed, e, feedTitle) {
  const ch = await client.channels.fetch(feed.channel_id).catch(() => null);
  if (!ch) return;
  const p = PLATFORMS[feed.platform]; const ping = pingOf(feed.guild_id, feed.role_id);
  const name = feed.display || feedTitle || p.name;
  const vars = { name, title: e.title || '', link: e.link || '', author: e.author || name };
  const prefix = ping.text ? `${ping.text} ` : '';

  if (feed.platform === 'youtube') { // a bare link makes Discord show the playable video preview
    const body = fmtText(feed.message || '📺 **{name}** just uploaded: {title}\n{link}', vars);
    return ch.send({ content: `${prefix}${body}`.slice(0, 2000), allowedMentions: ping.allowed }).catch(() => {});
  }
  const embed = new EmbedBuilder().setColor(p.color).setFooter({ text: p.name }).setTimestamp(e.published || Date.now());
  embed.setAuthor({ name: (e.author || name).slice(0, 256), iconURL: e.authorIcon || undefined });
  if (e.title) embed.setTitle(e.title.slice(0, 256));
  if (e.link) embed.setURL(e.link);
  if (e.summary && e.summary !== e.title) embed.setDescription(e.summary.slice(0, 1000));
  if (e.image && /^https?:/.test(e.image)) embed.setImage(e.image);
  const body = feed.message ? fmtText(feed.message, vars) : '';
  return ch.send({ content: `${prefix}${body}`.trim() || undefined, embeds: [embed], allowedMentions: ping.allowed }).catch(() => {});
}

async function pollFeed(client, feed, cache) {
  const { title, entries } = await entriesFor(feed, cache);
  const seen = new Set(db.prepare('SELECT item_id FROM feed_seen WHERE feed_id = ?').all(feed.id).map((r) => r.item_id));
  const fresh = entries.filter((e) => e.id && !seen.has(e.id));
  if (!fresh.length) return;
  const ins = db.prepare('INSERT OR IGNORE INTO feed_seen (feed_id, item_id) VALUES (?, ?)');
  for (const e of fresh) ins.run(feed.id, e.id);
  // oldest first, and never flood: at most 5 per check
  const toPost = fresh.sort((a, b) => (a.published || 0) - (b.published || 0)).slice(-5);
  for (const e of toPost) await post(client, feed, e, title);
  db.prepare('DELETE FROM feed_seen WHERE feed_id = ? AND rowid NOT IN (SELECT rowid FROM feed_seen WHERE feed_id = ? ORDER BY rowid DESC LIMIT 300)').run(feed.id, feed.id);
}

const MAX_FEEDS = 15;
// Validates a feed, saves it, and marks existing items as seen. Throws Error with a user-friendly message.
async function addFeed(guildId, { platform, target, channelId, roleId, message }) {
  if (!PLATFORMS[platform]) throw new Error('Unknown platform.');
  if (db.prepare('SELECT COUNT(*) AS c FROM feeds WHERE guild_id = ?').get(guildId).c >= MAX_FEEDS) throw new Error(`Each server can follow up to ${MAX_FEEDS} feeds.`);
  const r = await resolve(platform, String(target || ''));
  const { title, entries } = await entriesFor({ platform, target: r.target, url: r.url, display: r.display });
  const display = r.display || title || r.target;
  const id = db.prepare('INSERT INTO feeds (guild_id, platform, target, display, url, channel_id, role_id, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(guildId, platform, r.target, display, r.url, channelId, roleId || null, message || null).lastInsertRowid;
  const ins = db.prepare('INSERT OR IGNORE INTO feed_seen (feed_id, item_id) VALUES (?, ?)');
  for (const e of entries) if (e.id) ins.run(id, e.id); // existing items are not re-posted
  return { id, display };
}

const choices = Object.entries(PLATFORMS).map(([value, p]) => ({ name: p.name, value }));

module.exports = {
  api: { addFeed, platforms: Object.entries(PLATFORMS).map(([v, p]) => [v, p.name]) },
  init(client) {
    let running = false;
    const run = async () => {
      if (running) return; // a slow cycle must not overlap the next one
      running = true;
      try {
        const cache = new Map();
        for (const feed of db.prepare('SELECT * FROM feeds').all()) {
          const before = cache.size;
          await pollFeed(client, feed, cache).catch((e) => console.error(`[feed ${feed.id} ${feed.platform}]`, e.message));
          if (cache.size > before) await new Promise((r) => setTimeout(r, 1500)); // only pause after a real network fetch
        }
      } finally { running = false; }
    };
    setTimeout(run, 20000);
    setInterval(run, 5 * 60 * 1000);
  },
  commands: [{
    data: new SlashCommandBuilder().setName('feed').setDescription('Post new videos/posts from social media and websites').setDefaultMemberPermissions(P.ManageGuild)
      .addSubcommand((s) => s.setName('add').setDescription('Follow an account or feed')
        .addStringOption((o) => o.setName('platform').setDescription('Where it comes from').setRequired(true).addChoices(...choices))
        .addStringOption((o) => o.setName('target').setDescription('YouTube @handle/URL, r/sub, bluesky handle, @user@instance, owner/repo, username, or feed URL').setRequired(true))
        .addChannelOption((o) => o.setName('channel').setDescription('Where to post').setRequired(true))
        .addRoleOption((o) => o.setName('ping').setDescription('Role to ping (@everyone works too)'))
        .addStringOption((o) => o.setName('message').setDescription('Custom text. Use {name} {title} {link} {author}')))
      .addSubcommand((s) => s.setName('remove').setDescription('Stop following').addIntegerOption((o) => o.setName('id').setDescription('Feed ID from /feed list').setRequired(true)))
      .addSubcommand((s) => s.setName('list').setDescription('List followed feeds'))
      .addSubcommand((s) => s.setName('test').setDescription('Post the latest item now to check it works').addIntegerOption((o) => o.setName('id').setDescription('Feed ID').setRequired(true))),
    async execute(i) {
      const g = i.guildId; const sub = i.options.getSubcommand();
      if (sub === 'list') {
        const rows = db.prepare('SELECT * FROM feeds WHERE guild_id = ?').all(g);
        const text = rows.map((f) => `**#${f.id}** ${PLATFORMS[f.platform].name} — ${f.display || f.target} → <#${f.channel_id}>`).join('\n');
        return i.reply({ embeds: [new EmbedBuilder().setTitle('Feeds').setDescription(text || 'Nothing followed yet. Use `/feed add`.')], flags: EPH });
      }
      if (sub === 'remove') {
        const id = i.options.getInteger('id');
        const r = db.prepare('DELETE FROM feeds WHERE id = ? AND guild_id = ?').run(id, g);
        db.prepare('DELETE FROM feed_seen WHERE feed_id = ?').run(id);
        return i.reply({ content: r.changes ? '🗑️ Removed.' : 'No feed with that ID.', flags: EPH });
      }
      if (sub === 'test') {
        const feed = db.prepare('SELECT * FROM feeds WHERE id = ? AND guild_id = ?').get(i.options.getInteger('id'), g);
        if (!feed) return i.reply({ content: 'No feed with that ID.', flags: EPH });
        await i.deferReply({ flags: EPH });
        try {
          const { title, entries } = await entriesFor(feed);
          if (!entries.length) return i.editReply('The feed is reachable but has no items.');
          const latest = [...entries].sort((a, b) => (b.published || 0) - (a.published || 0))[0];
          await post(i.client, feed, latest, title);
          return i.editReply('✅ Posted the latest item.');
        } catch (e) { return i.editReply(`❌ ${e.message}`); }
      }

      // add
      await i.deferReply({ flags: EPH });
      const platform = i.options.getString('platform');
      try {
        const ch = i.options.getChannel('channel');
        const { id, display } = await addFeed(g, { platform, target: i.options.getString('target'), channelId: ch.id, roleId: i.options.getRole('ping')?.id || null, message: i.options.getString('message') });
        i.editReply(`✅ Following **${display}** (#${id}). New items will appear in ${ch}, checked every 5 minutes. Use \`/feed test id:${id}\` to preview.`);
      } catch (e) {
        i.editReply(`❌ Couldn't set that up: ${e.message}${['twitter', 'tiktok', 'instagram'].includes(platform) ? '\nThese go through RSSHub, which often needs its own login/config; see the notes in `.env.example`.' : ''}`);
      }
    },
  }],
};
