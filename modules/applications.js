const { SlashCommandBuilder, PermissionFlagsBits: P, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const { db } = require('../db');
const { EPH } = require('../utils');

db.exec('CREATE TABLE IF NOT EXISTS app_forms (guild_id TEXT, name TEXT, questions TEXT, channel_id TEXT, role_id TEXT, PRIMARY KEY (guild_id, name))');
const getForm = (g, name) => db.prepare('SELECT * FROM app_forms WHERE guild_id = ? AND name = ?').get(g, name);
const clean = (s) => s.toLowerCase().replace(/[^\w-]/g, '').slice(0, 30);

module.exports = {
  commands: [{
    data: new SlashCommandBuilder().setName('applications').setDescription('Application forms (staff, roles, etc.)').setDefaultMemberPermissions(P.ManageGuild)
      .addSubcommand((s) => s.setName('create').setDescription('Create or update a form')
        .addStringOption((o) => o.setName('name').setDescription('Short name, e.g. staff').setRequired(true))
        .addStringOption((o) => o.setName('questions').setDescription('Up to 5 questions separated by | (45 chars each)').setRequired(true))
        .addChannelOption((o) => o.setName('review_channel').setDescription('Where submissions are posted').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role given when accepted')))
      .addSubcommand((s) => s.setName('panel').setDescription('Post the Apply button here')
        .addStringOption((o) => o.setName('name').setDescription('Form name').setRequired(true)))
      .addSubcommand((s) => s.setName('delete').setDescription('Delete a form')
        .addStringOption((o) => o.setName('name').setDescription('Form name').setRequired(true)))
      .addSubcommand((s) => s.setName('list').setDescription('List forms')),
    async execute(i) {
      const g = i.guildId; const sub = i.options.getSubcommand();
      if (sub === 'list') {
        const rows = db.prepare('SELECT name, questions FROM app_forms WHERE guild_id = ?').all(g);
        return i.reply({ content: rows.length ? rows.map((r) => `\`${r.name}\` (${JSON.parse(r.questions).length} questions)`).join('\n') : 'No forms yet.', flags: EPH });
      }
      const name = clean(i.options.getString('name'));
      if (sub === 'create') {
        const qs = i.options.getString('questions').split('|').map((q) => q.trim().slice(0, 45)).filter(Boolean).slice(0, 5);
        if (!qs.length) return i.reply({ content: 'Give at least one question.', flags: EPH });
        db.prepare('INSERT INTO app_forms VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, name) DO UPDATE SET questions = excluded.questions, channel_id = excluded.channel_id, role_id = excluded.role_id')
          .run(g, name, JSON.stringify(qs), i.options.getChannel('review_channel').id, i.options.getRole('role')?.id || null);
        return i.reply({ content: `✅ Form \`${name}\` saved. Use \`/applications panel name:${name}\` to post the button.`, flags: EPH });
      }
      if (sub === 'delete') {
        const r = db.prepare('DELETE FROM app_forms WHERE guild_id = ? AND name = ?').run(g, name);
        return i.reply({ content: r.changes ? '🗑️ Deleted.' : 'No such form.', flags: EPH });
      }
      if (!getForm(g, name)) return i.reply({ content: 'No such form.', flags: EPH });
      await i.channel.send({
        embeds: [new EmbedBuilder().setTitle(`📝 ${name} application`).setDescription('Click the button to apply.')],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`app:open:${name}`).setLabel('Apply').setStyle(ButtonStyle.Primary))],
      });
      i.reply({ content: '✅ Panel posted.', flags: EPH });
    },
  }],

  // handles the Apply button, the modal submit, and Accept/Deny buttons
  buttons: [{
    prefix: 'app:',
    async execute(i) {
      const [, action, ...rest] = i.customId.split(':');
      if (action === 'open') {
        const form = getForm(i.guildId, rest[0]);
        if (!form) return i.reply({ content: 'That form no longer exists.', flags: EPH });
        const modal = new ModalBuilder().setCustomId(`app:submit:${rest[0]}`).setTitle(`${rest[0]} application`.slice(0, 45));
        JSON.parse(form.questions).forEach((q, n) => modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId(`q${n}`).setLabel(q).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000))));
        return i.showModal(modal);
      }
      if (action === 'submit') {
        const form = getForm(i.guildId, rest[0]);
        const ch = form && i.guild.channels.cache.get(form.channel_id);
        if (!ch) return i.reply({ content: 'The review channel is missing. Tell a staff member.', flags: EPH });
        const e = new EmbedBuilder().setColor(0x3498db).setTitle(`New ${rest[0]} application`).setThumbnail(i.user.displayAvatarURL())
          .setDescription(`From ${i.user} (${i.user.id})`).setTimestamp();
        JSON.parse(form.questions).forEach((q, n) => e.addFields({ name: q.slice(0, 256), value: i.fields.getTextInputValue(`q${n}`).slice(0, 1024) || '—' }));
        await ch.send({ embeds: [e], components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`app:accept:${i.user.id}:${rest[0]}`).setLabel('Accept').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`app:deny:${i.user.id}:${rest[0]}`).setLabel('Deny').setStyle(ButtonStyle.Danger))] });
        return i.reply({ content: '✅ Application submitted!', flags: EPH });
      }
      // accept / deny
      if (!i.memberPermissions.has(P.ManageGuild)) return i.reply({ content: 'Staff only.', flags: EPH });
      const [userId, name] = rest; const accepted = action === 'accept';
      const form = getForm(i.guildId, name);
      const member = await i.guild.members.fetch(userId).catch(() => null);
      if (accepted && form?.role_id && member) member.roles.add(form.role_id).catch(() => {});
      (member?.user || await i.client.users.fetch(userId).catch(() => null))
        ?.send(accepted ? `🎉 Your **${name}** application in **${i.guild.name}** was accepted!` : `Your **${name}** application in **${i.guild.name}** was not accepted this time.`).catch(() => {});
      await i.update({
        embeds: [EmbedBuilder.from(i.message.embeds[0]).setColor(accepted ? 0x2ecc71 : 0xe74c3c).setFooter({ text: `${accepted ? 'Accepted' : 'Denied'} by ${i.user.tag}` })],
        components: [],
      });
    },
  }],
};
