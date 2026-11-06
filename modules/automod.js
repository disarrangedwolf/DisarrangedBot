const { Events, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getSetting } = require('../db');
const { log } = require('../utils');

const recent = new Map();
setInterval(() => { const cut = Date.now() - 10000; for (const [k, a] of recent) if (!a.length || a[a.length - 1] < cut) recent.delete(k); }, 600000);
const INVITE = /(discord\.gg|discord(?:app)?\.com\/invite)\/\w+/i;
const on = (g, f) => getSetting(g, `automod_${f}`, '0') === '1';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function punish(msg, reason, timeoutMs) {
  await msg.delete().catch(() => {});
  const note = await msg.channel.send(`${msg.author}, ${reason}.`).catch(() => null);
  if (note) setTimeout(() => note.delete().catch(() => {}), 5000);
  if (timeoutMs && msg.member?.moderatable) msg.member.timeout(timeoutMs, `AutoMod: ${reason}`).catch(() => {});
  log(msg.guild, new EmbedBuilder().setColor(0xe74c3c).setTitle('AutoMod')
    .setDescription(`${msg.author} in ${msg.channel} — ${reason}\n\n${msg.content.slice(0, 1000)}`).setTimestamp());
}

module.exports = {
  events: [{
    name: Events.MessageCreate,
    async execute(msg) {
      if (!msg.guild || msg.author.bot || !msg.member) return;
      if (msg.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
      const g = msg.guildId; const text = msg.content;

      if (on(g, 'invites') && INVITE.test(text)) return punish(msg, "invites aren't allowed here");

      if (on(g, 'words')) {
        const list = getSetting(g, 'badwords', '').split(',').map((w) => w.trim()).filter(Boolean);
        if (list.some((w) => new RegExp(`\\b${esc(w)}\\b`, 'i').test(text))) return punish(msg, 'watch your language');
      }

      if (on(g, 'caps')) {
        const letters = text.replace(/[^a-z]/gi, '');
        if (letters.length >= 12 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) return punish(msg, 'please ease up on the caps');
      }

      if (on(g, 'mentions') && msg.mentions.users.size >= 5) return punish(msg, 'too many mentions', 5 * 6e4);

      if (on(g, 'spam')) {
        const key = `${g}:${msg.author.id}`;
        const now = Date.now();
        const hits = (recent.get(key) || []).filter((t) => now - t < 5000);
        hits.push(now);
        recent.set(key, hits);
        if (hits.length >= 6) { recent.delete(key); return punish(msg, 'slow down, no spamming', 5 * 6e4); }
      }
    },
  }],
};
