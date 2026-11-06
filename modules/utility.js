const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { EPH, inviteUrl } = require('../utils');

const BALL = ['It is certain.', 'Without a doubt.', 'Yes, definitely.', 'Most likely.', 'Signs point to yes.', 'Ask again later.',
  'Cannot predict now.', "Don't count on it.", 'My sources say no.', 'Very doubtful.'];
const ts = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

module.exports = {
  commands: [
    {
      data: new SlashCommandBuilder().setName('help').setDescription('List everything I can do'),
      async execute(i) {
        const lines = [...i.client.commands.values()].map((c) => `\`/${c.data.name}\` — ${c.data.description}`).join('\n');
        i.reply({ embeds: [new EmbedBuilder().setTitle('Commands').setDescription(lines.slice(0, 4000))], flags: EPH });
      },
    },
    {
      data: new SlashCommandBuilder().setName('ping').setDescription('Check latency'),
      async execute(i) { i.reply(`🏓 Pong! ${i.client.ws.ping}ms`); },
    },
    {
      data: new SlashCommandBuilder().setName('userinfo').setDescription('Info about a member').addUserOption((o) => o.setName('user').setDescription('Member')),
      async execute(i) {
        const u = i.options.getUser('user') || i.user; const m = await i.guild.members.fetch(u.id).catch(() => null);
        const e = new EmbedBuilder().setTitle(u.tag).setThumbnail(u.displayAvatarURL()).addFields(
          { name: 'ID', value: u.id, inline: true }, { name: 'Created', value: ts(u.createdTimestamp), inline: true });
        if (m) e.addFields({ name: 'Joined', value: ts(m.joinedTimestamp), inline: true },
          { name: 'Roles', value: m.roles.cache.filter((r) => r.id !== i.guildId).map((r) => `${r}`).join(' ') || 'None' });
        i.reply({ embeds: [e] });
      },
    },
    {
      data: new SlashCommandBuilder().setName('serverinfo').setDescription('Info about this server'),
      async execute(i) {
        const g = i.guild;
        i.reply({ embeds: [new EmbedBuilder().setTitle(g.name).setThumbnail(g.iconURL()).addFields(
          { name: 'Members', value: String(g.memberCount), inline: true }, { name: 'Channels', value: String(g.channels.cache.size), inline: true },
          { name: 'Roles', value: String(g.roles.cache.size), inline: true }, { name: 'Created', value: ts(g.createdTimestamp), inline: true },
          { name: 'Boost level', value: String(g.premiumTier), inline: true })] });
      },
    },
    {
      data: new SlashCommandBuilder().setName('avatar').setDescription("Show someone's avatar").addUserOption((o) => o.setName('user').setDescription('Member')),
      async execute(i) {
        const u = i.options.getUser('user') || i.user;
        i.reply({ embeds: [new EmbedBuilder().setTitle(`${u.username}'s avatar`).setImage(u.displayAvatarURL({ size: 1024 }))] });
      },
    },
    {
      data: new SlashCommandBuilder().setName('roll').setDescription('Roll dice')
        .addStringOption((o) => o.setName('dice').setDescription('e.g. 2d6 (default 1d20)')),
      async execute(i) {
        const m = /^(\d{1,2})d(\d{1,4})$/i.exec(i.options.getString('dice') || '1d20');
        if (!m) return i.reply({ content: 'Use the format `2d6`.', flags: EPH });
        const rolls = Array.from({ length: +m[1] }, () => 1 + Math.floor(Math.random() * +m[2]));
        i.reply(`🎲 ${rolls.join(' + ')} = **${rolls.reduce((a, b) => a + b, 0)}**`);
      },
    },
    {
      data: new SlashCommandBuilder().setName('8ball').setDescription('Ask the magic 8-ball')
        .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true)),
      async execute(i) { i.reply(`🎱 ${BALL[Math.floor(Math.random() * BALL.length)]}`); },
    },
    {
      data: new SlashCommandBuilder().setName('choose').setDescription('Pick one option for you')
        .addStringOption((o) => o.setName('options').setDescription('Comma-separated options').setRequired(true)),
      async execute(i) {
        const opts = i.options.getString('options').split(',').map((s) => s.trim()).filter(Boolean);
        if (opts.length < 2) return i.reply({ content: 'Give me at least two options.', flags: EPH });
        i.reply({ content: `🤔 I choose: **${opts[Math.floor(Math.random() * opts.length)]}**`, allowedMentions: { parse: [] } });
      },
    },
    {
      data: new SlashCommandBuilder().setName('invite').setDescription('Get a link to add me to another server'),
      async execute(i) { i.reply({ content: `Add me to a server: ${inviteUrl(i.client)}`, flags: EPH }); },
    },
  ],
};
