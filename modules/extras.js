const { Events, SlashCommandBuilder, PermissionFlagsBits: P, EmbedBuilder } = require('discord.js');
const { db } = require('../db');
const { EPH, parseDuration, log } = require('../utils');

db.exec(`
CREATE TABLE IF NOT EXISTS autoresponders (guild_id TEXT, word TEXT, response TEXT, PRIMARY KEY (guild_id, word));
CREATE TABLE IF NOT EXISTS tempbans (guild_id TEXT, user_id TEXT, due INTEGER, PRIMARY KEY (guild_id, user_id));
`);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cooldown = new Map();
setInterval(() => { const cut = Date.now() - 60000; for (const [k, t] of cooldown) if (t < cut) cooldown.delete(k); }, 600000);

module.exports = {
  init(client) {
    setInterval(async () => {
      const due = db.prepare('SELECT * FROM tempbans WHERE due <= ?').all(Date.now());
      for (const t of due) {
        db.prepare('DELETE FROM tempbans WHERE guild_id = ? AND user_id = ?').run(t.guild_id, t.user_id);
        const guild = await client.guilds.fetch(t.guild_id).catch(() => null);
        if (guild) guild.members.unban(t.user_id, 'Tempban expired').catch(() => {});
      }
    }, 60000);
  },

  events: [{
    name: Events.MessageCreate, // autoresponders
    async execute(msg) {
      if (!msg.guild || msg.author.bot || !msg.content) return;
      const rows = db.prepare('SELECT * FROM autoresponders WHERE guild_id = ?').all(msg.guildId);
      for (const r of rows) {
        if (!new RegExp(`\\b${esc(r.word)}\\b`, 'i').test(msg.content)) continue;
        const key = `${msg.channelId}:${r.word}`;
        if (Date.now() - (cooldown.get(key) || 0) < 10000) continue;
        cooldown.set(key, Date.now());
        msg.channel.send({ content: r.response, allowedMentions: { parse: [] } }).catch(() => {});
        break;
      }
    },
  }],

  commands: [
    {
      data: new SlashCommandBuilder().setName('announce').setDescription('Post an announcement embed').setDefaultMemberPermissions(P.ManageMessages)
        .addChannelOption((o) => o.setName('channel').setDescription('Where to post').setRequired(true))
        .addStringOption((o) => o.setName('message').setDescription('Text (use \\n for new lines)').setRequired(true))
        .addStringOption((o) => o.setName('title').setDescription('Title'))
        .addRoleOption((o) => o.setName('ping').setDescription('Role to ping')),
      async execute(i) {
        const ch = i.options.getChannel('channel'); const role = i.options.getRole('ping');
        await ch.send({
          content: role ? `${role}` : undefined, allowedMentions: { roles: role ? [role.id] : [] },
          embeds: [new EmbedBuilder().setTitle(i.options.getString('title') || '📢 Announcement').setDescription(i.options.getString('message').replaceAll('\\n', '\n')).setTimestamp()],
        });
        i.reply({ content: `✅ Posted in ${ch}.`, flags: EPH });
      },
    },
    {
      data: new SlashCommandBuilder().setName('autorespond').setDescription('Auto-reply when a word appears').setDefaultMemberPermissions(P.ManageGuild)
        .addSubcommand((s) => s.setName('add').setDescription('Add or update')
          .addStringOption((o) => o.setName('word').setDescription('Trigger word or phrase').setRequired(true))
          .addStringOption((o) => o.setName('response').setDescription('Reply').setRequired(true)))
        .addSubcommand((s) => s.setName('remove').setDescription('Remove').addStringOption((o) => o.setName('word').setDescription('Trigger').setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('List')),
      async execute(i) {
        const g = i.guildId; const sub = i.options.getSubcommand(); const word = i.options.getString('word')?.toLowerCase();
        if (sub === 'add') {
          db.prepare('INSERT INTO autoresponders VALUES (?, ?, ?) ON CONFLICT(guild_id, word) DO UPDATE SET response = excluded.response').run(g, word, i.options.getString('response'));
          return i.reply({ content: `✅ Added \`${word}\`.`, flags: EPH });
        }
        if (sub === 'remove') {
          const r = db.prepare('DELETE FROM autoresponders WHERE guild_id = ? AND word = ?').run(g, word);
          return i.reply({ content: r.changes ? '🗑️ Removed.' : 'No such trigger.', flags: EPH });
        }
        const rows = db.prepare('SELECT word FROM autoresponders WHERE guild_id = ?').all(g);
        i.reply({ content: rows.length ? rows.map((r) => `\`${r.word}\``).join(' ') : 'None yet.', flags: EPH });
      },
    },
    {
      data: new SlashCommandBuilder().setName('tempban').setDescription('Ban someone for a set time').setDefaultMemberPermissions(P.BanMembers)
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
        .addStringOption((o) => o.setName('duration').setDescription('e.g. 1d, 12h, 2w').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason')),
      async execute(i) {
        const u = i.options.getUser('user'); const m = i.options.getMember('user'); const ms = parseDuration(i.options.getString('duration'));
        if (!ms) return i.reply({ content: 'Use a duration like `12h`, `1d`, `2w`.', flags: EPH });
        if (m && !m.bannable) return i.reply({ content: "I can't ban that member.", flags: EPH });
        const reason = i.options.getString('reason') || 'No reason given';
        await i.guild.members.ban(u, { reason: `Tempban by ${i.user.tag}: ${reason}` });
        db.prepare('INSERT INTO tempbans VALUES (?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET due = excluded.due').run(i.guildId, u.id, Date.now() + ms);
        log(i.guild, new EmbedBuilder().setColor(0xe67e22).setTitle('Tempban').setDescription(`${u} by ${i.user}, until <t:${Math.floor((Date.now() + ms) / 1000)}:R>\n${reason}`).setTimestamp());
        i.reply(`⏳ Banned **${u.tag}** until <t:${Math.floor((Date.now() + ms) / 1000)}:R>.`);
      },
    },
    {
      data: new SlashCommandBuilder().setName('role').setDescription('Give or remove a role').setDefaultMemberPermissions(P.ManageRoles)
        .addSubcommand((s) => s.setName('give').setDescription('Give a role')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand((s) => s.setName('take').setDescription('Remove a role')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))),
      async execute(i) {
        const m = i.options.getMember('user'); const role = i.options.getRole('role');
        const allowed = i.user.id === i.guild.ownerId || i.member.roles.highest.comparePositionTo(role) > 0;
        if (!m || !role.editable || !allowed) return i.reply({ content: "❌ I can't (or you can't) manage that role.", flags: EPH });
        const give = i.options.getSubcommand() === 'give';
        await (give ? m.roles.add(role) : m.roles.remove(role));
        i.reply({ content: `✅ ${give ? 'Gave' : 'Removed'} ${role} ${give ? 'to' : 'from'} ${m}.`, allowedMentions: { parse: [] } });
      },
    },
  ],
};
