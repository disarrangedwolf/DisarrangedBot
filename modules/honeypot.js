const { Events, SlashCommandBuilder, PermissionFlagsBits: P, EmbedBuilder } = require('discord.js');
const { getSetting, setSetting } = require('../db');
const { EPH, log } = require('../utils');

module.exports = {
  events: [{
    name: Events.MessageCreate,
    async execute(msg) {
      if (!msg.guild || msg.author.bot || !msg.member) return;
      const g = msg.guildId;
      if (msg.channelId !== getSetting(g, 'honeypot_channel')) return;
      if (msg.member.permissions.has(P.ManageMessages)) return; // staff are exempt
      const action = getSetting(g, 'honeypot_action', 'ban');
      await msg.delete().catch(() => {});
      let done = false;
      if (action === 'ban' && msg.member.bannable) {
        // also wipes the last hour of their messages, which cleans up spam-bot floods
        done = await msg.guild.members.ban(msg.author, { reason: 'Honeypot', deleteMessageSeconds: 3600 }).then(() => true).catch(() => false);
      } else if (action === 'kick' && msg.member.kickable) {
        done = await msg.member.kick('Honeypot').then(() => true).catch(() => false);
      }
      log(msg.guild, new EmbedBuilder().setColor(0xe67e22).setTitle('🍯 Honeypot triggered')
        .setDescription(`${msg.author} (${msg.author.id}) — ${done ? `${action}ned` : `could not ${action}`}\n\n${msg.content.slice(0, 500)}`).setTimestamp());
    },
  }],
  commands: [{
    data: new SlashCommandBuilder().setName('honeypot').setDescription('Trap channel that punishes anyone who posts in it')
      .setDefaultMemberPermissions(P.Administrator)
      .addSubcommand((s) => s.setName('set').setDescription('Turn a channel into a honeypot')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true))
        .addStringOption((o) => o.setName('action').setDescription('Default: ban').addChoices({ name: 'Ban', value: 'ban' }, { name: 'Kick', value: 'kick' })))
      .addSubcommand((s) => s.setName('off').setDescription('Disable the honeypot')),
    async execute(i) {
      if (i.options.getSubcommand() === 'off') { setSetting(i.guildId, 'honeypot_channel', ''); return i.reply({ content: '✅ Honeypot disabled.', flags: EPH }); }
      const ch = i.options.getChannel('channel'); const action = i.options.getString('action') || 'ban';
      setSetting(i.guildId, 'honeypot_channel', ch.id); setSetting(i.guildId, 'honeypot_action', action);
      await ch.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('⚠️ DO NOT POST IN THIS CHANNEL')
        .setDescription(`Anyone who sends a message here is automatically ${action === 'ban' ? 'banned' : 'kicked'}. This catches hacked accounts and spam bots.`)] }).catch(() => {});
      i.reply({ content: `✅ ${ch} is now a honeypot (${action}). Staff with Manage Messages are exempt, so test with an alt account.`, flags: EPH });
    },
  }],
};
