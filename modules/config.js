const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { setSetting, db } = require('../db');
const { EPH } = require('../utils');

const CHANNELS = [
  ['Log channel', 'log_channel'], ['Welcome channel', 'welcome_channel'], ['Goodbye channel', 'goodbye_channel'],
  ['Starboard', 'starboard_channel'], ['Suggestions', 'suggestion_channel'],
  ['Level-up announcements', 'levelup_channel'], ['Ticket category', 'ticket_category'],
];
const ROLES = [['Auto-role for new members', 'autorole'], ['Ticket support role', 'ticket_support_role']];
const AUTOMOD = [['Spam', 'spam'], ['Discord invites', 'invites'], ['Excess caps', 'caps'], ['Mass mentions', 'mentions'], ['Bad words', 'words']];
const choices = (a) => a.map(([name, value]) => ({ name, value }));

module.exports = {
  commands: [{
    data: new SlashCommandBuilder().setName('config').setDescription('Configure the bot for this server')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((s) => s.setName('channel').setDescription('Set a channel')
        .addStringOption((o) => o.setName('type').setDescription('Which one').setRequired(true).addChoices(...choices(CHANNELS)))
        .addChannelOption((o) => o.setName('channel').setDescription('Channel (or category for tickets)').setRequired(true)))
      .addSubcommand((s) => s.setName('role').setDescription('Set a role')
        .addStringOption((o) => o.setName('type').setDescription('Which one').setRequired(true).addChoices(...choices(ROLES)))
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
      .addSubcommand((s) => s.setName('message').setDescription('Set welcome/goodbye text ({user} {username} {server} {count})')
        .addStringOption((o) => o.setName('type').setDescription('Which one').setRequired(true)
          .addChoices({ name: 'Welcome', value: 'welcome_message' }, { name: 'Goodbye', value: 'goodbye_message' }))
        .addStringOption((o) => o.setName('text').setDescription('Message text').setRequired(true)))
      .addSubcommand((s) => s.setName('levelrole').setDescription('Give a role at a level')
        .addIntegerOption((o) => o.setName('level').setDescription('Level').setMinValue(1).setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
      .addSubcommand((s) => s.setName('automod').setDescription('Toggle an AutoMod feature')
        .addStringOption((o) => o.setName('feature').setDescription('Feature').setRequired(true).addChoices(...choices(AUTOMOD)))
        .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
      .addSubcommand((s) => s.setName('badwords').setDescription('Set the bad-word list (comma separated)')
        .addStringOption((o) => o.setName('words').setDescription('word1, word2, ...').setRequired(true))),
    async execute(i) {
      const g = i.guildId;
      const sub = i.options.getSubcommand();
      if (sub === 'channel') {
        const ch = i.options.getChannel('channel');
        setSetting(g, i.options.getString('type'), ch.id);
        return i.reply({ content: `✅ Saved: ${ch}`, flags: EPH });
      }
      if (sub === 'role') {
        const role = i.options.getRole('role');
        setSetting(g, i.options.getString('type'), role.id);
        return i.reply({ content: `✅ Saved: ${role}`, flags: EPH });
      }
      if (sub === 'message') {
        setSetting(g, i.options.getString('type'), i.options.getString('text'));
        return i.reply({ content: '✅ Message saved.', flags: EPH });
      }
      if (sub === 'levelrole') {
        const lvl = i.options.getInteger('level');
        const role = i.options.getRole('role');
        db.prepare('INSERT INTO level_roles VALUES (?, ?, ?) ON CONFLICT(guild_id, level) DO UPDATE SET role_id = excluded.role_id').run(g, lvl, role.id);
        return i.reply({ content: `✅ ${role} will be given at level ${lvl}.`, flags: EPH });
      }
      if (sub === 'automod') {
        const f = i.options.getString('feature');
        const on = i.options.getBoolean('enabled');
        setSetting(g, `automod_${f}`, on ? '1' : '0');
        return i.reply({ content: `✅ AutoMod **${f}** is now ${on ? 'on' : 'off'}.`, flags: EPH });
      }
      if (sub === 'badwords') {
        setSetting(g, 'badwords', i.options.getString('words'));
        return i.reply({ content: '✅ Bad-word list saved (turn on the "Bad words" AutoMod feature to use it).', flags: EPH });
      }
    },
  }],
};
