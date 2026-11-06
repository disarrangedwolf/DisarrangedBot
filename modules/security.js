const { Events, SlashCommandBuilder, PermissionFlagsBits: P, EmbedBuilder, AuditLogEvent, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getSetting, setSetting } = require('../db');
const { EPH, log } = require('../utils');

const joins = new Map();
const actions = new Map();
setInterval(() => { const cut = Date.now() - 30000; for (const m of [joins, actions]) for (const [k, a] of m) if (!a.length || a[a.length - 1] < cut) m.delete(k); }, 600000);
const on = (g, k) => getSetting(g, k, '0') === '1';
const emb = (title, desc) => new EmbedBuilder().setColor(0xc0392b).setTitle(title).setDescription(desc).setTimestamp();

// Anti-nuke: if one person deletes/bans too much too fast, strip their roles
async function guard(guild, type, targetId, kind, limit) {
  if (!on(guild.id, 'antinuke')) return;
  await new Promise((r) => setTimeout(r, 1000)); // audit log entries lag slightly
  const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(() => null);
  const entry = logs?.entries.find((e) => e.targetId === targetId && Date.now() - e.createdTimestamp < 15000);
  if (!entry || !entry.executor) return;
  const id = entry.executor.id;
  if (id === guild.ownerId || id === guild.client.user.id) return;
  if (getSetting(guild.id, 'nuke_whitelist', '').split(',').includes(id)) return;

  const key = `${guild.id}:${id}:${kind}`; const now = Date.now();
  const arr = (actions.get(key) || []).filter((t) => now - t < 15000);
  arr.push(now); actions.set(key, arr);
  if (arr.length < limit) return;
  actions.delete(key);

  const member = await guild.members.fetch(id).catch(() => null);
  let result = 'could not punish (check my role position)';
  if (member) {
    const removable = member.roles.cache.filter((r) => r.id !== guild.id && r.editable);
    if (removable.size) { await member.roles.remove(removable, 'Anti-nuke').catch(() => {}); result = `removed ${removable.size} role(s)`; }
    if (member.user.bot && member.kickable) { await member.kick('Anti-nuke').catch(() => {}); result = 'kicked the bot'; }
  }
  const e = emb('🚨 Anti-nuke triggered', `${entry.executor} did **${limit}+ ${kind} actions** in 15s — ${result}.`);
  log(guild, e);
  guild.fetchOwner().then((o) => o.send({ embeds: [e] })).catch(() => {});
}

module.exports = {
  events: [
    {
      name: Events.GuildMemberAdd,
      async execute(m) {
        const g = m.guild.id;
        if (m.user.bot) return;
        const minAge = Number(getSetting(g, 'min_account_age', 0));
        if (minAge && Date.now() - m.user.createdTimestamp < minAge * 864e5) {
          await m.send(`Your account is too new to join **${m.guild.name}** (minimum ${minAge} days).`).catch(() => {});
          await m.kick('Account too new').catch(() => {});
          return log(m.guild, emb('Account too new', `${m.user.tag} kicked (account under ${minAge} days old).`));
        }
        const now = Date.now();
        if (on(g, 'antiraid')) {
          const arr = (joins.get(g) || []).filter((t) => now - t < 10000); arr.push(now); joins.set(g, arr);
          if (arr.length >= Number(getSetting(g, 'raid_threshold', 5)) && !on(g, 'raidmode')) {
            setSetting(g, 'raidmode', '1'); setSetting(g, 'raidmode_until', now + 10 * 6e4);
            log(m.guild, emb('🚨 Raid mode enabled', `${arr.length} joins in 10s. New joiners will be kicked for 10 minutes. Use \`/security raidmode enabled:false\` to end it.`));
          }
        }
        if (on(g, 'raidmode')) {
          if (now > Number(getSetting(g, 'raidmode_until', 0))) { setSetting(g, 'raidmode', '0'); return; }
          await m.send(`**${m.guild.name}** is temporarily closed to new members. Please try again later.`).catch(() => {});
          await m.kick('Raid mode').catch(() => {});
          log(m.guild, emb('Raid mode kick', `${m.user.tag} (${m.id})`));
        }
      },
    },
    { name: Events.ChannelDelete, execute: (ch) => ch.guild && guard(ch.guild, AuditLogEvent.ChannelDelete, ch.id, 'channel-delete', 3) },
    { name: Events.GuildRoleDelete, execute: (r) => guard(r.guild, AuditLogEvent.RoleDelete, r.id, 'role-delete', 3) },
    { name: Events.GuildBanAdd, execute: (b) => guard(b.guild, AuditLogEvent.MemberBanAdd, b.user.id, 'ban', 4) },
  ],
  commands: [
    {
      data: new SlashCommandBuilder().setName('security').setDescription('Anti-raid and anti-nuke protection').setDefaultMemberPermissions(P.Administrator)
        .addSubcommand((s) => s.setName('status').setDescription('Show protection settings'))
        .addSubcommand((s) => s.setName('antiraid').setDescription('Auto raid mode when many users join at once')
          .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true))
          .addIntegerOption((o) => o.setName('threshold').setDescription('Joins within 10s that trigger it (default 5)').setMinValue(3).setMaxValue(50)))
        .addSubcommand((s) => s.setName('raidmode').setDescription('Manually toggle raid mode (kicks new joiners for 1h)')
          .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
        .addSubcommand((s) => s.setName('accountage').setDescription('Kick joiners with accounts younger than N days (0 = off)')
          .addIntegerOption((o) => o.setName('days').setDescription('Days').setMinValue(0).setMaxValue(365).setRequired(true)))
        .addSubcommand((s) => s.setName('antinuke').setDescription('Strip roles from anyone mass-deleting or mass-banning')
          .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
        .addSubcommand((s) => s.setName('whitelist').setDescription('Exempt a trusted user from anti-nuke')
          .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
          .addBooleanOption((o) => o.setName('allowed').setDescription('Trusted? (default yes)'))),
      async execute(i) {
        const g = i.guildId; const sub = i.options.getSubcommand(); const flag = (v) => (v ? '1' : '0');
        if (sub === 'status') {
          const yn = (k) => (on(g, k) ? '✅ on' : '❌ off');
          return i.reply({ flags: EPH, embeds: [new EmbedBuilder().setTitle('🛡️ Security').setDescription(
            `Anti-raid: ${yn('antiraid')} (threshold ${getSetting(g, 'raid_threshold', 5)})\nRaid mode now: ${yn('raidmode')}\nAnti-nuke: ${yn('antinuke')}\n` +
            `Min account age: ${Number(getSetting(g, 'min_account_age', 0)) || 'off'}\nTrusted users: ${getSetting(g, 'nuke_whitelist', '') || 'none'}`)] });
        }
        if (sub === 'antiraid') {
          setSetting(g, 'antiraid', flag(i.options.getBoolean('enabled')));
          if (i.options.getInteger('threshold')) setSetting(g, 'raid_threshold', i.options.getInteger('threshold'));
        } else if (sub === 'raidmode') {
          const e = i.options.getBoolean('enabled');
          setSetting(g, 'raidmode', flag(e)); setSetting(g, 'raidmode_until', Date.now() + 36e5);
        } else if (sub === 'accountage') {
          setSetting(g, 'min_account_age', i.options.getInteger('days'));
        } else if (sub === 'antinuke') {
          setSetting(g, 'antinuke', flag(i.options.getBoolean('enabled')));
        } else if (sub === 'whitelist') {
          const u = i.options.getUser('user'); const allowed = i.options.getBoolean('allowed') ?? true;
          const list = getSetting(g, 'nuke_whitelist', '').split(',').filter((x) => x && x !== u.id);
          if (allowed) list.push(u.id);
          setSetting(g, 'nuke_whitelist', list.join(','));
        }
        i.reply({ content: '✅ Updated. Use `/security status` to review.', flags: EPH });
      },
    },
    {
      data: new SlashCommandBuilder().setName('verification').setDescription('Post a "Verify" button that grants a role').setDefaultMemberPermissions(P.Administrator)
        .addRoleOption((o) => o.setName('role').setDescription('Role given after verifying').setRequired(true)),
      async execute(i) {
        const role = i.options.getRole('role');
        await i.channel.send({
          embeds: [new EmbedBuilder().setTitle('✅ Verify').setDescription('Click the button to verify and unlock the server.')],
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`verify:${role.id}`).setLabel('Verify').setStyle(ButtonStyle.Success))],
        });
        i.reply({ content: '✅ Panel posted. Hide other channels from @everyone and show them to this role.', flags: EPH });
      },
    },
  ],
  buttons: [{
    prefix: 'verify:',
    async execute(i) {
      const role = i.guild.roles.cache.get(i.customId.split(':')[1]);
      if (!role || !role.editable) return i.reply({ content: "I can't give that role (check my role position).", flags: EPH });
      await i.member.roles.add(role);
      i.reply({ content: '✅ You are verified. Welcome!', flags: EPH });
    },
  }],
};
