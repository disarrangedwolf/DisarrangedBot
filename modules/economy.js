const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { db } = require('../db');
const { EPH } = require('../utils');

const eco = (g, u) => {
  db.prepare('INSERT OR IGNORE INTO economy (guild_id, user_id) VALUES (?, ?)').run(g, u);
  return db.prepare('SELECT * FROM economy WHERE guild_id = ? AND user_id = ?').get(g, u);
};
const add = (g, u, n) => db.prepare('UPDATE economy SET balance = balance + ? WHERE guild_id = ? AND user_id = ?').run(n, g, u);
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const amountOpt = (o) => o.setName('amount').setDescription('Amount').setMinValue(1).setRequired(true);
const when = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

module.exports = {
  commands: [
    {
      data: new SlashCommandBuilder().setName('balance').setDescription('Check coins').addUserOption((o) => o.setName('user').setDescription('Another member')),
      async execute(i) {
        const u = i.options.getUser('user') || i.user;
        i.reply(`💰 **${u.username}** has **${eco(i.guildId, u.id).balance}** coins.`);
      },
    },
    {
      data: new SlashCommandBuilder().setName('daily').setDescription('Claim your daily coins'),
      async execute(i) {
        const row = eco(i.guildId, i.user.id);
        if (Date.now() - row.last_daily < 864e5) return i.reply({ content: `⏳ Come back ${when(row.last_daily + 864e5)}.`, flags: EPH });
        const n = rand(100, 200); add(i.guildId, i.user.id, n);
        db.prepare('UPDATE economy SET last_daily = ? WHERE guild_id = ? AND user_id = ?').run(Date.now(), i.guildId, i.user.id);
        i.reply(`🎁 You claimed **${n}** coins!`);
      },
    },
    {
      data: new SlashCommandBuilder().setName('work').setDescription('Work for some coins (1h cooldown)'),
      async execute(i) {
        const row = eco(i.guildId, i.user.id);
        if (Date.now() - row.last_work < 36e5) return i.reply({ content: `⏳ You can work again ${when(row.last_work + 36e5)}.`, flags: EPH });
        const n = rand(20, 80); add(i.guildId, i.user.id, n);
        db.prepare('UPDATE economy SET last_work = ? WHERE guild_id = ? AND user_id = ?').run(Date.now(), i.guildId, i.user.id);
        i.reply(`🛠️ You worked and earned **${n}** coins.`);
      },
    },
    {
      data: new SlashCommandBuilder().setName('pay').setDescription('Send coins to someone')
        .addUserOption((o) => o.setName('user').setDescription('Recipient').setRequired(true)).addIntegerOption(amountOpt),
      async execute(i) {
        const to = i.options.getUser('user'); const n = i.options.getInteger('amount');
        if (to.bot || to.id === i.user.id) return i.reply({ content: "You can't pay that user.", flags: EPH });
        if (eco(i.guildId, i.user.id).balance < n) return i.reply({ content: "You don't have enough coins.", flags: EPH });
        eco(i.guildId, to.id);
        db.transaction(() => { add(i.guildId, i.user.id, -n); add(i.guildId, to.id, n); })();
        i.reply(`💸 Sent **${n}** coins to ${to}.`);
      },
    },
    {
      data: new SlashCommandBuilder().setName('flip').setDescription('Bet coins on a coin flip')
        .addIntegerOption(amountOpt)
        .addStringOption((o) => o.setName('side').setDescription('Heads or tails').setRequired(true).addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' })),
      async execute(i) {
        const n = i.options.getInteger('amount');
        if (eco(i.guildId, i.user.id).balance < n) return i.reply({ content: "You don't have enough coins.", flags: EPH });
        const result = Math.random() < 0.5 ? 'heads' : 'tails';
        const won = result === i.options.getString('side');
        add(i.guildId, i.user.id, won ? n : -n);
        i.reply(`🪙 It landed on **${result}**. You ${won ? `won **${n}**` : `lost **${n}**`} coins.`);
      },
    },
    {
      data: new SlashCommandBuilder().setName('richest').setDescription('Top 10 richest members'),
      async execute(i) {
        const rows = db.prepare('SELECT * FROM economy WHERE guild_id = ? ORDER BY balance DESC LIMIT 10').all(i.guildId);
        const text = rows.length ? rows.map((r, n) => `**${n + 1}.** <@${r.user_id}> — ${r.balance}`).join('\n') : 'Nobody has coins yet.';
        i.reply({ embeds: [new EmbedBuilder().setTitle('💰 Richest members').setDescription(text)], allowedMentions: { parse: [] } });
      },
    },
  ],
};
