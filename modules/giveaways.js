const { SlashCommandBuilder, PermissionFlagsBits: P, EmbedBuilder } = require('discord.js');
const { db } = require('../db');
const { EPH, parseDuration } = require('../utils');

async function finish(client, row) {
  db.prepare('UPDATE giveaways SET ended = 1 WHERE id = ?').run(row.id);
  const ch = await client.channels.fetch(row.channel_id).catch(() => null);
  const msg = ch && (await ch.messages.fetch(row.message_id).catch(() => null));
  if (!msg) return null;
  const reaction = msg.reactions.cache.get('🎉');
  const users = reaction ? [...(await reaction.users.fetch()).filter((u) => !u.bot).values()] : [];
  const winners = users.sort(() => Math.random() - 0.5).slice(0, row.winners);
  const text = winners.length ? winners.map((w) => `${w}`).join(', ') : 'No valid entries.';
  await msg.edit({ embeds: [new EmbedBuilder().setColor(0x95a5a6).setTitle(`🎉 ${row.prize}`).setDescription(`**Ended**\nWinner(s): ${text}`)] }).catch(() => {});
  if (winners.length) ch.send(`🎊 Congratulations ${text}! You won **${row.prize}**!`);
  return winners;
}

module.exports = {
  init(client) {
    setInterval(() => {
      const due = db.prepare('SELECT * FROM giveaways WHERE ended = 0 AND ends <= ?').all(Date.now());
      for (const row of due) finish(client, row).catch(console.error);
    }, 30000);
  },
  commands: [{
    data: new SlashCommandBuilder().setName('giveaway').setDescription('Run giveaways').setDefaultMemberPermissions(P.ManageGuild)
      .addSubcommand((s) => s.setName('start').setDescription('Start a giveaway')
        .addStringOption((o) => o.setName('prize').setDescription('Prize').setRequired(true))
        .addStringOption((o) => o.setName('duration').setDescription('e.g. 30m, 2h, 1d').setRequired(true))
        .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners').setMinValue(1).setMaxValue(20)))
      .addSubcommand((s) => s.setName('end').setDescription('End a giveaway now')
        .addIntegerOption((o) => o.setName('id').setDescription('Giveaway ID').setRequired(true)))
      .addSubcommand((s) => s.setName('reroll').setDescription('Pick new winner(s)')
        .addIntegerOption((o) => o.setName('id').setDescription('Giveaway ID').setRequired(true))),
    async execute(i) {
      const sub = i.options.getSubcommand();
      if (sub === 'start') {
        const ms = parseDuration(i.options.getString('duration'));
        if (!ms) return i.reply({ content: 'Use a duration like `30m`, `2h`, `1d`.', flags: EPH });
        const prize = i.options.getString('prize'); const winners = i.options.getInteger('winners') || 1; const ends = Date.now() + ms;
        await i.reply({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle(`🎉 ${prize}`)
          .setDescription(`React with 🎉 to enter!\nEnds <t:${Math.floor(ends / 1000)}:R> • ${winners} winner(s)`)] });
        const m = await i.fetchReply();
        await m.react('🎉');
        const id = db.prepare('INSERT INTO giveaways (guild_id, channel_id, message_id, prize, winners, ends) VALUES (?, ?, ?, ?, ?, ?)')
          .run(i.guildId, i.channelId, m.id, prize, winners, ends).lastInsertRowid;
        return i.followUp({ content: `Giveaway ID: **${id}**`, flags: EPH });
      }
      const row = db.prepare('SELECT * FROM giveaways WHERE id = ? AND guild_id = ?').get(i.options.getInteger('id'), i.guildId);
      if (!row) return i.reply({ content: 'No giveaway with that ID.', flags: EPH });
      if (sub === 'end' && row.ended) return i.reply({ content: 'That giveaway already ended (try reroll).', flags: EPH });
      await i.reply({ content: sub === 'end' ? '✅ Ending…' : '✅ Rerolling…', flags: EPH });
      await finish(i.client, row);
    },
  }],
};
