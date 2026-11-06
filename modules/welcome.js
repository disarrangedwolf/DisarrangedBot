const { Events } = require('discord.js');
const { getSetting } = require('../db');

const fmt = (t, m) => t.replaceAll('{user}', `${m}`).replaceAll('{username}', m.user.username)
  .replaceAll('{server}', m.guild.name).replaceAll('{count}', String(m.guild.memberCount));

module.exports = {
  events: [
    {
      name: Events.GuildMemberAdd,
      async execute(m) {
        const roleId = getSetting(m.guild.id, 'autorole');
        if (roleId) m.roles.add(roleId).catch(() => {});
        const ch = m.guild.channels.cache.get(getSetting(m.guild.id, 'welcome_channel'));
        if (ch) ch.send(fmt(getSetting(m.guild.id, 'welcome_message', 'Welcome {user} to **{server}**! You are member #{count}. 🎉'), m)).catch(() => {});
      },
    },
    {
      name: Events.GuildMemberRemove,
      async execute(m) {
        const ch = m.guild.channels.cache.get(getSetting(m.guild.id, 'goodbye_channel'));
        if (ch) ch.send(fmt(getSetting(m.guild.id, 'goodbye_message', '**{username}** has left the server. 👋'), m)).catch(() => {});
      },
    },
  ],
};
