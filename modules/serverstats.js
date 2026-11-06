const { SlashCommandBuilder, PermissionFlagsBits: P, ChannelType } = require('discord.js');
const { getSetting, setSetting } = require('../db');
const { EPH } = require('../utils');

const KEYS = ['stats_members', 'stats_bots', 'stats_total'];

async function update(guild) {
  if (!KEYS.some((k) => getSetting(guild.id, k))) return;
  let members;
  try { members = await guild.members.fetch(); } catch { members = guild.members.cache; }
  const bots = members.filter((m) => m.user.bot).size;
  const names = {
    stats_members: `👥 Members: ${members.size - bots}`,
    stats_bots: `🤖 Bots: ${bots}`,
    stats_total: `📈 Total: ${guild.memberCount}`,
  };
  for (const [key, name] of Object.entries(names)) {
    const id = getSetting(guild.id, key);
    const ch = id && guild.channels.cache.get(id);
    if (ch && ch.name !== name) await ch.setName(name).catch(() => {});
  }
}

module.exports = {
  init(client) {
    // Discord limits channel renames, so refresh every 10 minutes
    setInterval(() => client.guilds.cache.forEach((g) => update(g).catch(() => {})), 10 * 60 * 1000);
  },
  commands: [{
    data: new SlashCommandBuilder().setName('serverstats').setDescription('Live stat channels (member count, bots, total)')
      .setDefaultMemberPermissions(P.ManageChannels)
      .addSubcommand((s) => s.setName('setup').setDescription('Create the stat channels'))
      .addSubcommand((s) => s.setName('remove').setDescription('Delete the stat channels')),
    async execute(i) {
      const g = i.guild;
      await i.deferReply({ flags: EPH });
      if (i.options.getSubcommand() === 'setup') {
        const overwrites = [{ id: g.roles.everyone.id, deny: [P.Connect], allow: [P.ViewChannel] }];
        const cat = await g.channels.create({ name: '📊 Server Stats', type: ChannelType.GuildCategory, position: 0, permissionOverwrites: overwrites });
        setSetting(g.id, 'stats_category', cat.id);
        for (const key of KEYS) {
          const ch = await g.channels.create({ name: 'loading…', type: ChannelType.GuildVoice, parent: cat.id, permissionOverwrites: overwrites });
          setSetting(g.id, key, ch.id);
        }
        await update(g);
        return i.editReply('✅ Stat channels created. They refresh every 10 minutes.');
      }
      for (const key of [...KEYS, 'stats_category']) {
        const ch = g.channels.cache.get(getSetting(g.id, key));
        if (ch) await ch.delete().catch(() => {});
        setSetting(g.id, key, '');
      }
      i.editReply('🗑️ Stat channels removed.');
    },
  }],
};
