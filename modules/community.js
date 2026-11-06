const { Events, SlashCommandBuilder, PermissionFlagsBits: P, EmbedBuilder } = require('discord.js');
const { db, getSetting } = require('../db');
const { EPH, parseDuration } = require('../utils');

const NUMS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

module.exports = {
  init(client) {
    setInterval(async () => {
      const due = db.prepare('SELECT * FROM reminders WHERE due <= ?').all(Date.now());
      for (const r of due) {
        db.prepare('DELETE FROM reminders WHERE id = ?').run(r.id);
        const ch = await client.channels.fetch(r.channel_id).catch(() => null);
        if (ch) ch.send(`⏰ <@${r.user_id}> reminder: ${r.message}`).catch(() => {});
      }
    }, 15000);
  },

  events: [{
    name: Events.MessageReactionAdd, // starboard
    async execute(reaction, user) {
      if (user.bot) return;
      if (reaction.partial) await reaction.fetch().catch(() => {});
      const msg = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
      if (!msg || !msg.guild || reaction.emoji.name !== '⭐') return;
      const chId = getSetting(msg.guildId, 'starboard_channel');
      if (!chId || msg.channelId === chId) return;
      if (reaction.count < Number(getSetting(msg.guildId, 'starboard_threshold', 3))) return;
      if (db.prepare('SELECT 1 FROM starred WHERE message_id = ?').get(msg.id)) return;
      const board = msg.guild.channels.cache.get(chId);
      if (!board) return;
      db.prepare('INSERT INTO starred (message_id) VALUES (?)').run(msg.id);
      const e = new EmbedBuilder().setColor(0xf1c40f).setAuthor({ name: msg.author.tag, iconURL: msg.author.displayAvatarURL() })
        .setDescription(`${msg.content || ''}\n\n[Jump to message](${msg.url})`).setTimestamp(msg.createdAt);
      const img = msg.attachments.find((a) => a.contentType?.startsWith('image/'));
      if (img) e.setImage(img.url);
      board.send({ content: `⭐ **${reaction.count}** in ${msg.channel}`, embeds: [e] }).catch(() => {});
    },
  }],

  commands: [
    {
      data: new SlashCommandBuilder().setName('poll').setDescription('Create a poll')
        .addStringOption((o) => o.setName('question').setDescription('Question').setRequired(true))
        .addStringOption((o) => o.setName('options').setDescription('Comma-separated options (max 10). Leave empty for yes/no')),
      async execute(i) {
        const opts = (i.options.getString('options') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
        const emojis = opts.length >= 2 ? NUMS.slice(0, opts.length) : ['👍', '👎'];
        const body = opts.length >= 2 ? opts.map((o, n) => `${NUMS[n]} ${o}`).join('\n') : 'Vote with 👍 or 👎';
        await i.reply({ embeds: [new EmbedBuilder().setTitle(`📊 ${i.options.getString('question')}`).setDescription(body).setFooter({ text: `Poll by ${i.user.username}` })] });
        const m = await i.fetchReply();
        for (const e of emojis) await m.react(e);
      },
    },
    {
      data: new SlashCommandBuilder().setName('suggest').setDescription('Submit a suggestion')
        .addStringOption((o) => o.setName('idea').setDescription('Your suggestion').setRequired(true)),
      async execute(i) {
        const ch = i.guild.channels.cache.get(getSetting(i.guildId, 'suggestion_channel')) || i.channel;
        const m = await ch.send({ embeds: [new EmbedBuilder().setAuthor({ name: i.user.tag, iconURL: i.user.displayAvatarURL() }).setTitle('💡 Suggestion').setDescription(i.options.getString('idea'))] });
        await m.react('👍'); await m.react('👎');
        i.reply({ content: `✅ Posted in ${ch}.`, flags: EPH });
      },
    },
    {
      data: new SlashCommandBuilder().setName('tag').setDescription('Custom commands / saved snippets')
        .addSubcommand((s) => s.setName('get').setDescription('Show a tag').addStringOption((o) => o.setName('name').setDescription('Tag name').setRequired(true)))
        .addSubcommand((s) => s.setName('create').setDescription('Create or update a tag (staff)')
          .addStringOption((o) => o.setName('name').setDescription('Tag name').setRequired(true))
          .addStringOption((o) => o.setName('content').setDescription('What it says').setRequired(true)))
        .addSubcommand((s) => s.setName('delete').setDescription('Delete a tag (staff)').addStringOption((o) => o.setName('name').setDescription('Tag name').setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('List tags')),
      async execute(i) {
        const g = i.guildId; const sub = i.options.getSubcommand();
        const name = i.options.getString('name')?.toLowerCase();
        const staff = i.memberPermissions.has(P.ManageMessages);
        if (sub === 'get') {
          const t = db.prepare('SELECT content FROM tags WHERE guild_id = ? AND name = ?').get(g, name);
          return i.reply(t ? { content: t.content, allowedMentions: { parse: [] } } : { content: 'No such tag.', flags: EPH });
        }
        if (sub === 'list') {
          const rows = db.prepare('SELECT name FROM tags WHERE guild_id = ? ORDER BY name').all(g);
          return i.reply({ content: rows.length ? rows.map((r) => `\`${r.name}\``).join(' ') : 'No tags yet.', flags: EPH });
        }
        if (!staff) return i.reply({ content: 'You need Manage Messages for that.', flags: EPH });
        if (sub === 'create') {
          db.prepare('INSERT INTO tags VALUES (?, ?, ?) ON CONFLICT(guild_id, name) DO UPDATE SET content = excluded.content').run(g, name, i.options.getString('content'));
          return i.reply({ content: `✅ Tag \`${name}\` saved.`, flags: EPH });
        }
        const r = db.prepare('DELETE FROM tags WHERE guild_id = ? AND name = ?').run(g, name);
        i.reply({ content: r.changes ? `🗑️ Deleted \`${name}\`.` : 'No such tag.', flags: EPH });
      },
    },
    {
      data: new SlashCommandBuilder().setName('remind').setDescription('Set a reminder')
        .addStringOption((o) => o.setName('in').setDescription('e.g. 30m, 2h, 1d').setRequired(true))
        .addStringOption((o) => o.setName('message').setDescription('What to remind you about').setRequired(true)),
      async execute(i) {
        const ms = parseDuration(i.options.getString('in'));
        if (!ms) return i.reply({ content: 'Use a time like `30m`, `2h`, `1d`.', flags: EPH });
        db.prepare('INSERT INTO reminders (user_id, channel_id, message, due) VALUES (?, ?, ?, ?)').run(i.user.id, i.channelId, i.options.getString('message'), Date.now() + ms);
        i.reply({ content: `⏰ I'll remind you <t:${Math.floor((Date.now() + ms) / 1000)}:R>.`, flags: EPH });
      },
    },
  ],
};
