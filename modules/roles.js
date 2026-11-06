const { SlashCommandBuilder, PermissionFlagsBits: P, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { EPH } = require('../utils');

const builder = new SlashCommandBuilder().setName('rolepanel').setDescription('Post a self-assign role panel (buttons)')
  .setDefaultMemberPermissions(P.ManageRoles)
  .addStringOption((o) => o.setName('title').setDescription('Panel title').setRequired(true))
  .addRoleOption((o) => o.setName('role1').setDescription('Role 1').setRequired(true));
for (let n = 2; n <= 5; n++) builder.addRoleOption((o) => o.setName(`role${n}`).setDescription(`Role ${n}`));

module.exports = {
  commands: [{
    data: builder,
    async execute(i) {
      const roles = [1, 2, 3, 4, 5].map((n) => i.options.getRole(`role${n}`)).filter(Boolean);
      const row = new ActionRowBuilder().addComponents(roles.map((r) => new ButtonBuilder().setCustomId(`rr:${r.id}`).setLabel(r.name).setStyle(ButtonStyle.Secondary)));
      await i.channel.send({ embeds: [new EmbedBuilder().setTitle(i.options.getString('title')).setDescription('Click a button to add or remove a role.')], components: [row] });
      i.reply({ content: '✅ Panel posted.', flags: EPH });
    },
  }],
  buttons: [{
    prefix: 'rr:',
    async execute(i) {
      const role = i.guild.roles.cache.get(i.customId.split(':')[1]);
      if (!role || !role.editable) return i.reply({ content: "I can't manage that role (check my role position).", flags: EPH });
      const has = i.member.roles.cache.has(role.id);
      await (has ? i.member.roles.remove(role) : i.member.roles.add(role));
      i.reply({ content: has ? `Removed ${role}.` : `Added ${role}.`, flags: EPH });
    },
  }],
};
