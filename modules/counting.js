const { Events, SlashCommandBuilder, PermissionFlagsBits: P } = require('discord.js');
const { getSetting, setSetting } = require('../db');
const { EPH } = require('../utils');

module.exports = {
  events: [{
    name: Events.MessageCreate,
    async execute(msg) {
      if (!msg.guild || msg.author.bot) return;
      const g = msg.guildId;
      if (msg.channelId !== getSetting(g, 'counting_channel')) return;
      const text = msg.content.trim();
      if (!/^\d+$/.test(text)) return; // normal chatter is ignored
      const n = Number(text);
      const cur = Number(getSetting(g, 'count_current', 0));
      const last = getSetting(g, 'count_last_user', '');

      let why = null;
      if (cur > 0 && msg.author.id === last) why = "you can't count twice in a row";
      else if (n !== cur + 1) why = `the next number was **${cur + 1}**`;

      if (why) {
        setSetting(g, 'count_current', 0);
        setSetting(g, 'count_last_user', '');
        await msg.react('❌').catch(() => {});
        return msg.channel.send(cur === 0 ? 'Start with **1**.' : `${msg.author} ruined it at **${cur}**: ${why}. Start again from **1**!`);
      }
      setSetting(g, 'count_current', n);
      setSetting(g, 'count_last_user', msg.author.id);
      if (n > Number(getSetting(g, 'count_high', 0))) { setSetting(g, 'count_high', n); await msg.react('🏆').catch(() => {}); }
      else await msg.react('✅').catch(() => {});
    },
  }],
  commands: [{
    data: new SlashCommandBuilder().setName('counting').setDescription('Counting game')
      .addSubcommand((s) => s.setName('setup').setDescription('Set the counting channel (staff)')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)))
      .addSubcommand((s) => s.setName('stats').setDescription('Current and record count'))
      .addSubcommand((s) => s.setName('reset').setDescription('Reset the count to 0 (staff)')),
    async execute(i) {
      const g = i.guildId; const sub = i.options.getSubcommand();
      if (sub === 'stats') {
        return i.reply(`🔢 Current: **${getSetting(g, 'count_current', 0)}** • Record: **${getSetting(g, 'count_high', 0)}**`);
      }
      if (!i.memberPermissions.has(P.ManageGuild)) return i.reply({ content: 'You need Manage Server for that.', flags: EPH });
      if (sub === 'setup') {
        const ch = i.options.getChannel('channel');
        setSetting(g, 'counting_channel', ch.id); setSetting(g, 'count_current', 0); setSetting(g, 'count_last_user', '');
        return i.reply({ content: `✅ Counting in ${ch}. Start at **1**. Nobody can count twice in a row.` });
      }
      setSetting(g, 'count_current', 0); setSetting(g, 'count_last_user', '');
      i.reply('🔄 Count reset to 0.');
    },
  }],
};
