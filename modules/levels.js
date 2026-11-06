const { Events, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { db, getSetting } = require('../db');

const cooldown = new Map();
setInterval(() => { const cut = Date.now() - 120000; for (const [k, t] of cooldown) if (t < cut) cooldown.delete(k); }, 600000);
const levelFor = (xp) => Math.floor(Math.sqrt(xp / 100));
const xpAt = (lvl) => lvl * lvl * 100;

module.exports = {
  events: [{
    name: Events.MessageCreate,
    async execute(msg) {
      if (!msg.guild || msg.author.bot) return;
      const g = msg.guildId; const u = msg.author.id; const key = `${g}:${u}`;
      if (Date.now() - (cooldown.get(key) || 0) < 60000) return;
      cooldown.set(key, Date.now());

      db.prepare('INSERT OR IGNORE INTO xp (guild_id, user_id) VALUES (?, ?)').run(g, u);
      const gain = 15 + Math.floor(Math.random() * 11);
      const row = db.prepare('UPDATE xp SET xp = xp + ? WHERE guild_id = ? AND user_id = ? RETURNING xp, level').get(gain, g, u);
      const lvl = levelFor(row.xp);
      if (lvl <= row.level) return;

      db.prepare('UPDATE xp SET level = ? WHERE guild_id = ? AND user_id = ?').run(lvl, g, u);
      const ch = msg.guild.channels.cache.get(getSetting(g, 'levelup_channel')) || msg.channel;
      ch.send(`🎉 ${msg.author} reached **level ${lvl}**!`).catch(() => {});
      const roles = db.prepare('SELECT role_id FROM level_roles WHERE guild_id = ? AND level <= ?').all(g, lvl);
      for (const r of roles) msg.member?.roles.add(r.role_id).catch(() => {});
    },
  }],
  commands: [
    {
      data: new SlashCommandBuilder().setName('rank').setDescription('Show your level and XP')
        .addUserOption((o) => o.setName('user').setDescription('Another member')),
      async execute(i) {
        const u = i.options.getUser('user') || i.user;
        const row = db.prepare('SELECT * FROM xp WHERE guild_id = ? AND user_id = ?').get(i.guildId, u.id) || { xp: 0, level: 0 };
        const rank = db.prepare('SELECT COUNT(*) + 1 AS r FROM xp WHERE guild_id = ? AND xp > ?').get(i.guildId, row.xp).r;
        const cur = row.xp - xpAt(row.level); const need = xpAt(row.level + 1) - xpAt(row.level);
        const filled = Math.max(0, Math.min(10, Math.round((cur / need) * 10)));
        i.reply({ embeds: [new EmbedBuilder().setTitle(u.username).setThumbnail(u.displayAvatarURL())
          .setDescription(`**Level ${row.level}** • Rank #${rank}\n${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${cur}/${need} XP`)] });
      },
    },
    {
      data: new SlashCommandBuilder().setName('leaderboard').setDescription('Top 10 members by XP'),
      async execute(i) {
        const rows = db.prepare('SELECT * FROM xp WHERE guild_id = ? ORDER BY xp DESC LIMIT 10').all(i.guildId);
        const text = rows.length ? rows.map((r, n) => `**${n + 1}.** <@${r.user_id}> — level ${r.level} (${r.xp} XP)`).join('\n') : 'Nobody has XP yet.';
        i.reply({ embeds: [new EmbedBuilder().setTitle('🏆 Leaderboard').setDescription(text)], allowedMentions: { parse: [] } });
      },
    },
  ],
};
