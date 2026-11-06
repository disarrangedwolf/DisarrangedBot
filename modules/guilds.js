const { Events, EmbedBuilder, ChannelType, PermissionFlagsBits: P } = require('discord.js');
const { db, clearGuildSettings } = require('../db');

db.exec('CREATE TABLE IF NOT EXISTS known_guilds (guild_id TEXT PRIMARY KEY, name TEXT, joined INTEGER, left_at INTEGER)');

const RETENTION = 30 * 864e5; // keep a server's data for 30 days after the bot leaves, in case it comes back
const GUILD_TABLES = ['warnings', 'xp', 'level_roles', 'economy', 'giveaways', 'tags', 'ticket_types', 'tickets', 'ticket_blacklist',
  'app_forms', 'backups', 'autoresponders', 'tempbans', 'live_alerts', 'feeds'];

function purge(guildId) {
  for (const t of GUILD_TABLES) {
    try {
      if (t === 'feeds') db.prepare('DELETE FROM feed_seen WHERE feed_id IN (SELECT id FROM feeds WHERE guild_id = ?)').run(guildId);
      db.prepare(`DELETE FROM ${t} WHERE guild_id = ?`).run(guildId);
    } catch (e) { console.error('[purge]', t, e.message); }
  }
  clearGuildSettings(guildId);
  db.prepare('DELETE FROM known_guilds WHERE guild_id = ?').run(guildId);
  console.log(`[guilds] purged data for ${guildId}`);
}

async function say(guild, embed) {
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me) return;
  const ch = [guild.systemChannel, ...guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).values()]
    .find((c) => c && c.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages]));
  if (ch) ch.send({ embeds: [embed] }).catch(() => {});
}

module.exports = {
  init(client) {
    // register servers we're already in (silently), and note any we were removed from while offline
    const ins = db.prepare('INSERT INTO known_guilds (guild_id, name, joined) VALUES (?, ?, ?) ON CONFLICT (guild_id) DO UPDATE SET name = excluded.name, left_at = NULL');
    for (const g of client.guilds.cache.values()) ins.run(g.id, g.name, Date.now());
    for (const r of db.prepare('SELECT guild_id FROM known_guilds WHERE left_at IS NULL').all()) {
      if (!client.guilds.cache.has(r.guild_id)) db.prepare('UPDATE known_guilds SET left_at = ? WHERE guild_id = ?').run(Date.now(), r.guild_id);
    }
    const sweep = () => {
      for (const r of db.prepare('SELECT guild_id FROM known_guilds WHERE left_at IS NOT NULL AND left_at < ?').all(Date.now() - RETENTION)) purge(r.guild_id);
    };
    sweep();
    setInterval(sweep, 6 * 36e5);
  },
  events: [
    {
      name: Events.GuildCreate,
      async execute(guild) {
        const known = db.prepare('SELECT * FROM known_guilds WHERE guild_id = ?').get(guild.id);
        db.prepare('INSERT INTO known_guilds (guild_id, name, joined) VALUES (?, ?, ?) ON CONFLICT (guild_id) DO UPDATE SET name = excluded.name, left_at = NULL').run(guild.id, guild.name, Date.now());
        if (known && !known.left_at) return; // just a restart or an outage recovery
        if (known?.left_at) return say(guild, new EmbedBuilder().setColor(0x2ecc71).setTitle('Welcome back! 👋').setDescription('Your previous settings, tickets, levels and feeds were kept. Run `/help` to see everything I can do.'));
        say(guild, new EmbedBuilder().setColor(0x5865f2).setTitle('Thanks for adding me! 👋')
          .setDescription('I handle moderation, tickets, levels, live-stream alerts, social feeds and more, so you only need one bot.\n\n' +
            '**Quick start** (needs Manage Server)\n' +
            '• `/config channel type:Log channel` to set up logging\n' +
            '• `/ticketsetup type-create` then `/ticketsetup panel` for tickets\n' +
            '• `/security status` for raid and nuke protection\n' +
            '• `/live add` and `/feed add` for stream alerts and social feeds\n' +
            '• `/help` lists every command\n\n' +
            '⚠️ Drag my role **above** the roles I should manage (auto-roles, role panels, timeouts).'));
      },
    },
    {
      name: Events.GuildDelete,
      execute(guild) {
        if (guild.available === false) return; // an outage, not a removal
        db.prepare('UPDATE known_guilds SET left_at = ? WHERE guild_id = ?').run(Date.now(), guild.id);
      },
    },
  ],
};
