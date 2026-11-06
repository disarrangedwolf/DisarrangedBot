const { SlashCommandBuilder, PermissionFlagsBits: P, EmbedBuilder } = require('discord.js');
const { db } = require('../db');
const { EPH, parseDuration, log } = require('../utils');

const userOpt = (o) => o.setName('user').setDescription('Target user').setRequired(true);
const reasonOpt = (o) => o.setName('reason').setDescription('Reason (optional)');
const getReason = (i) => i.options.getString('reason') || 'No reason given';
const deny = (i, t) => i.reply({ content: `❌ ${t}`, flags: EPH });
const modLog = (i, action, target, reason) => log(i.guild, new EmbedBuilder().setColor(0xe67e22).setTitle(action)
  .addFields(
    { name: 'User', value: `${target} (${target.id})`, inline: true },
    { name: 'Moderator', value: `${i.user}`, inline: true },
    { name: 'Reason', value: reason || 'No reason given' })
  .setTimestamp());

const commands = [
  {
    data: new SlashCommandBuilder().setName('kick').setDescription('Kick a member').setDefaultMemberPermissions(P.KickMembers)
      .addUserOption(userOpt).addStringOption(reasonOpt),
    async execute(i) {
      const m = i.options.getMember('user'); const r = getReason(i);
      if (!m || !m.kickable) return deny(i, "I can't kick that member.");
      await m.kick(`${i.user.tag}: ${r}`);
      await modLog(i, 'Member kicked', m.user, r);
      i.reply(`👢 Kicked **${m.user.tag}**.`);
    },
  },
  {
    data: new SlashCommandBuilder().setName('ban').setDescription('Ban a user').setDefaultMemberPermissions(P.BanMembers)
      .addUserOption(userOpt).addStringOption(reasonOpt)
      .addIntegerOption((o) => o.setName('delete_days').setDescription('Days of messages to delete (0-7)').setMinValue(0).setMaxValue(7)),
    async execute(i) {
      const u = i.options.getUser('user'); const m = i.options.getMember('user'); const r = getReason(i);
      if (m && !m.bannable) return deny(i, "I can't ban that member.");
      await i.guild.members.ban(u, { reason: `${i.user.tag}: ${r}`, deleteMessageSeconds: (i.options.getInteger('delete_days') || 0) * 86400 });
      await modLog(i, 'User banned', u, r);
      i.reply(`🔨 Banned **${u.tag}**.`);
    },
  },
  {
    data: new SlashCommandBuilder().setName('unban').setDescription('Unban a user by ID').setDefaultMemberPermissions(P.BanMembers)
      .addStringOption((o) => o.setName('user_id').setDescription('User ID').setRequired(true)).addStringOption(reasonOpt),
    async execute(i) {
      const id = i.options.getString('user_id');
      const u = await i.guild.members.unban(id, getReason(i)).catch(() => null);
      if (!u) return deny(i, 'That user is not banned.');
      await modLog(i, 'User unbanned', u, getReason(i));
      i.reply(`✅ Unbanned **${u.tag}**.`);
    },
  },
  {
    data: new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member').setDefaultMemberPermissions(P.ModerateMembers)
      .addUserOption(userOpt)
      .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 2h, 3d (max 28d)').setRequired(true))
      .addStringOption(reasonOpt),
    async execute(i) {
      const m = i.options.getMember('user'); const ms = parseDuration(i.options.getString('duration')); const r = getReason(i);
      if (!ms || ms > 28 * 864e5) return deny(i, 'Use a duration like `10m`, `2h`, `3d` (max 28d).');
      if (!m || !m.moderatable) return deny(i, "I can't timeout that member.");
      await m.timeout(ms, `${i.user.tag}: ${r}`);
      await modLog(i, 'Member timed out', m.user, r);
      i.reply(`🔇 Timed out **${m.user.tag}** until <t:${Math.floor((Date.now() + ms) / 1000)}:R>.`);
    },
  },
  {
    data: new SlashCommandBuilder().setName('untimeout').setDescription('Remove a timeout').setDefaultMemberPermissions(P.ModerateMembers)
      .addUserOption(userOpt),
    async execute(i) {
      const m = i.options.getMember('user');
      if (!m || !m.moderatable) return deny(i, "I can't change that member.");
      await m.timeout(null);
      i.reply(`🔊 Removed timeout from **${m.user.tag}**.`);
    },
  },
  {
    data: new SlashCommandBuilder().setName('warn').setDescription('Warn a member (3 warnings = 1h timeout)').setDefaultMemberPermissions(P.ModerateMembers)
      .addUserOption(userOpt).addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true)),
    async execute(i) {
      const m = i.options.getMember('user'); const r = getReason(i);
      if (!m) return deny(i, 'Member not found.');
      db.prepare('INSERT INTO warnings (guild_id, user_id, mod_id, reason, ts) VALUES (?, ?, ?, ?, ?)').run(i.guildId, m.id, i.user.id, r, Date.now());
      const n = db.prepare('SELECT COUNT(*) AS c FROM warnings WHERE guild_id = ? AND user_id = ?').get(i.guildId, m.id).c;
      m.send(`⚠️ You were warned in **${i.guild.name}**: ${r}`).catch(() => {});
      let extra = '';
      if (n >= 3 && m.moderatable) { await m.timeout(36e5, '3 warnings'); extra = ' Auto-timed out for 1h (3+ warnings).'; }
      await modLog(i, `Warning #${n}`, m.user, r);
      i.reply(`⚠️ Warned **${m.user.tag}** (${n} total).${extra}`);
    },
  },
  {
    data: new SlashCommandBuilder().setName('warnings').setDescription("List a member's warnings").setDefaultMemberPermissions(P.ModerateMembers)
      .addUserOption(userOpt),
    async execute(i) {
      const u = i.options.getUser('user');
      const rows = db.prepare('SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY ts DESC LIMIT 15').all(i.guildId, u.id);
      const text = rows.length ? rows.map((w) => `**#${w.id}** <t:${Math.floor(w.ts / 1000)}:R> — ${w.reason}`).join('\n') : 'No warnings.';
      i.reply({ embeds: [new EmbedBuilder().setTitle(`Warnings for ${u.tag}`).setDescription(text)], flags: EPH });
    },
  },
  {
    data: new SlashCommandBuilder().setName('clearwarnings').setDescription("Clear a member's warnings").setDefaultMemberPermissions(P.ModerateMembers)
      .addUserOption(userOpt),
    async execute(i) {
      const u = i.options.getUser('user');
      db.prepare('DELETE FROM warnings WHERE guild_id = ? AND user_id = ?').run(i.guildId, u.id);
      i.reply(`🧽 Cleared warnings for **${u.tag}**.`);
    },
  },
  {
    data: new SlashCommandBuilder().setName('purge').setDescription('Bulk delete messages (under 14 days old)').setDefaultMemberPermissions(P.ManageMessages)
      .addIntegerOption((o) => o.setName('amount').setDescription('How many (1-100)').setMinValue(1).setMaxValue(100).setRequired(true))
      .addUserOption((o) => o.setName('user').setDescription('Only this user\'s messages')),
    async execute(i) {
      const amt = i.options.getInteger('amount'); const u = i.options.getUser('user');
      await i.deferReply({ flags: EPH });
      let msgs = await i.channel.messages.fetch({ limit: u ? 100 : amt });
      if (u) msgs = msgs.filter((m) => m.author.id === u.id);
      const del = await i.channel.bulkDelete([...msgs.values()].slice(0, amt), true);
      i.editReply(`🧹 Deleted ${del.size} messages.`);
    },
  },
  {
    data: new SlashCommandBuilder().setName('slowmode').setDescription('Set channel slowmode').setDefaultMemberPermissions(P.ManageChannels)
      .addIntegerOption((o) => o.setName('seconds').setDescription('0 to turn off (max 21600)').setMinValue(0).setMaxValue(21600).setRequired(true)),
    async execute(i) {
      const s = i.options.getInteger('seconds');
      await i.channel.setRateLimitPerUser(s);
      i.reply(s ? `🐢 Slowmode set to ${s}s.` : '🐇 Slowmode off.');
    },
  },
  {
    data: new SlashCommandBuilder().setName('lock').setDescription('Lock this channel for @everyone').setDefaultMemberPermissions(P.ManageChannels),
    async execute(i) {
      await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: false });
      i.reply('🔒 Channel locked.');
    },
  },
  {
    data: new SlashCommandBuilder().setName('unlock').setDescription('Unlock this channel').setDefaultMemberPermissions(P.ManageChannels),
    async execute(i) {
      await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: null });
      i.reply('🔓 Channel unlocked.');
    },
  },
];

module.exports = { commands };
