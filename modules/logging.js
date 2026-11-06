const { Events, EmbedBuilder } = require('discord.js');
const { log } = require('../utils');

const emb = (color, title, desc) => new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc).setTimestamp();

module.exports = {
  events: [
    {
      name: Events.MessageDelete,
      execute(msg) {
        if (!msg.guild || msg.author?.bot || !msg.content) return;
        log(msg.guild, emb(0xe74c3c, 'Message deleted', `**Author:** ${msg.author}\n**Channel:** ${msg.channel}\n\n${msg.content.slice(0, 1500)}`));
      },
    },
    {
      name: Events.MessageUpdate,
      execute(a, b) {
        if (!b.guild || b.author?.bot || !a.content || a.content === b.content) return;
        log(b.guild, emb(0xf1c40f, 'Message edited', `**Author:** ${b.author}\n**Channel:** ${b.channel}\n[Jump](${b.url})\n\n**Before:** ${a.content.slice(0, 800)}\n**After:** ${(b.content || '').slice(0, 800)}`));
      },
    },
    { name: Events.GuildBanAdd, execute: (ban) => log(ban.guild, emb(0xc0392b, 'Member banned', `${ban.user} (${ban.user.id})\n${ban.reason || ''}`)) },
    { name: Events.GuildBanRemove, execute: (ban) => log(ban.guild, emb(0x2ecc71, 'Member unbanned', `${ban.user} (${ban.user.id})`)) },
    {
      name: Events.GuildMemberAdd,
      execute: (m) => log(m.guild, emb(0x2ecc71, 'Member joined', `${m} — account created <t:${Math.floor(m.user.createdTimestamp / 1000)}:R>`)),
    },
    { name: Events.GuildMemberRemove, execute: (m) => log(m.guild, emb(0x95a5a6, 'Member left', `${m.user.tag} (${m.id})`)) },
  ],
};
