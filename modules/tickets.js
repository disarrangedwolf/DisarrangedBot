const {
  SlashCommandBuilder, PermissionFlagsBits: P, ChannelType, OverwriteType, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, Events,
} = require('discord.js');
const { db, getSetting, setSetting } = require('../db');
const { EPH } = require('../utils');

db.exec(`
CREATE TABLE IF NOT EXISTS ticket_types (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, name TEXT, emoji TEXT, description TEXT,
  category_id TEXT, support_roles TEXT, welcome TEXT, questions TEXT, max_open INTEGER DEFAULT 1, naming TEXT, UNIQUE (guild_id, name));
CREATE TABLE IF NOT EXISTS tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, number INTEGER, channel_id TEXT, user_id TEXT, type_id INTEGER,
  status TEXT DEFAULT 'open', claimed_by TEXT, priority TEXT DEFAULT 'normal', created INTEGER, first_response INTEGER, closed_at INTEGER,
  closed_by TEXT, close_reason TEXT, rating INTEGER, feedback TEXT, last_activity INTEGER, warned INTEGER DEFAULT 0, answers TEXT);
CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets (channel_id);
CREATE TABLE IF NOT EXISTS ticket_blacklist (guild_id TEXT, user_id TEXT, reason TEXT, PRIMARY KEY (guild_id, user_id));
`);

// ---------- helpers ----------
const pad = (n) => String(n).padStart(4, '0');
const fmt = (t, v) => t.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
const PRIORITY = { low: '🟢 Low', normal: '🔵 Normal', high: '🟠 High', urgent: '🔴 Urgent' };
const getType = (id) => db.prepare('SELECT * FROM ticket_types WHERE id = ?').get(id);
const typeByName = (g, n) => db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? AND lower(name) = ?').get(g, n.trim().toLowerCase());
const byChannel = (cid) => db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(cid);
const byId = (id) => db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
const human = (ms) => {
  const m = Math.max(0, Math.floor(ms / 6e4));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};
function parseEmoji(s) {
  if (!s) return undefined;
  const c = /^<(a?):(\w+):(\d+)>$/.exec(s.trim());
  if (c) return { id: c[3], name: c[2], animated: !!c[1] };
  return /[^\x00-\x7F]/.test(s) ? { name: s.trim() } : undefined;
}
function supportRoles(type, g) {
  const arr = (type?.support_roles || '').split(',').filter(Boolean);
  const d = getSetting(g, 'ticket_support_role');
  if (d && !arr.includes(d)) arr.push(d);
  return arr;
}
const isStaff = (member, type, g) => member.permissions.has(P.ManageMessages) || supportRoles(type, g).some((r) => member.roles.cache.has(r));
const validCategory = (guild, id) => { const c = id && guild.channels.cache.get(id); return c && c.type === ChannelType.GuildCategory ? c.id : undefined; };
function tlog(guild, payload) {
  const id = getSetting(guild.id, 'ticket_log_channel') || getSetting(guild.id, 'log_channel');
  const ch = id && guild.channels.cache.get(id);
  if (ch) ch.send(payload).catch(() => {});
}
const ratingRow = (id) => new ActionRowBuilder().addComponents([1, 2, 3, 4, 5].map((n) =>
  new ButtonBuilder().setCustomId(`tkt:rate:${id}:${n}`).setLabel(`${n} ⭐`).setStyle(ButtonStyle.Secondary)));
const ticketButtons = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('tkt:claim').setLabel('Claim').setEmoji('🙋').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('tkt:close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger));

const questionsModal = (type) => {
  const m = new ModalBuilder().setCustomId(`tkt:modal:${type.id}`).setTitle(`${type.name} ticket`.slice(0, 45));
  JSON.parse(type.questions || '[]').forEach((q, n) => m.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(`q${n}`).setLabel(q).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000))));
  return m;
};
const closeModal = () => new ModalBuilder().setCustomId('tkt:closemodal').setTitle('Close ticket').addComponents(new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId('reason').setLabel('Reason (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)));

// ---------- opening ----------
async function beginOpen(i, typeId) {
  const g = i.guild; const type = getType(typeId);
  if (i.isStringSelectMenu()) i.message.edit({ components: i.message.components.map((r) => ActionRowBuilder.from(r)) }).catch(() => {}); // reset the dropdown
  if (!type || type.guild_id !== g.id) return i.reply({ content: 'That ticket type no longer exists.', flags: EPH });
  const bl = db.prepare('SELECT reason FROM ticket_blacklist WHERE guild_id = ? AND user_id = ?').get(g.id, i.user.id);
  if (bl) return i.reply({ content: `🚫 You can't open tickets${bl.reason ? `: ${bl.reason}` : '.'}`, flags: EPH });
  const open = db.prepare("SELECT channel_id FROM tickets WHERE guild_id = ? AND user_id = ? AND type_id = ? AND status = 'open'").all(g.id, i.user.id, type.id);
  if (open.length >= type.max_open) return i.reply({ content: `You already have ${open.length} open **${type.name}** ticket(s): ${open.map((o) => `<#${o.channel_id}>`).join(' ')}`, flags: EPH });
  if (JSON.parse(type.questions || '[]').length) return i.showModal(questionsModal(type));
  await i.deferReply({ flags: EPH });
  return createTicket(i, type, []);
}

async function createTicket(i, type, answers) {
  const g = i.guild;
  const number = db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM tickets WHERE guild_id = ?').get(g.id).n;
  const rowId = db.prepare('INSERT INTO tickets (guild_id, number, user_id, type_id, created, last_activity, answers) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(g.id, number, i.user.id, type.id, Date.now(), Date.now(), JSON.stringify(answers)).lastInsertRowid;
  const roles = supportRoles(type, g.id).filter((r) => g.roles.cache.has(r));
  const perms = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];
  const overwrites = [
    { id: g.roles.everyone.id, deny: [P.ViewChannel] },
    { id: i.user.id, allow: perms },
    { id: i.client.user.id, allow: [...perms, P.ManageChannels, P.ManageMessages] },
    ...roles.map((r) => ({ id: r, allow: [...perms, P.ManageMessages] })),
  ];
  const name = fmt(type.naming || '{type}-{number}', { type: type.name, number: pad(number), username: i.user.username })
    .toLowerCase().replace(/[^a-z0-9-_]+/g, '-').slice(0, 90);
  const parent = validCategory(g, type.category_id || getSetting(g.id, 'ticket_category'));
  const base = { name, type: ChannelType.GuildText, topic: `Ticket #${pad(number)} • ${type.name} • ${i.user.tag} (${i.user.id})`, permissionOverwrites: overwrites };
  let ch = await g.channels.create({ ...base, parent }).catch(() => null);
  if (!ch && parent) ch = await g.channels.create(base).catch(() => null); // category may be full
  if (!ch) {
    db.prepare('DELETE FROM tickets WHERE id = ?').run(rowId);
    return i.editReply('❌ I could not create the ticket channel. Check my permissions and the category channel limit.');
  }
  db.prepare('UPDATE tickets SET channel_id = ? WHERE id = ?').run(ch.id, rowId);

  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`${type.emoji ? `${type.emoji} ` : '🎫 '}${type.name} • #${pad(number)}`)
    .setDescription(fmt(type.welcome || 'Thanks for opening a ticket, {user}! Staff will be with you shortly. Please describe your issue in as much detail as you can.',
      { user: `${i.user}`, username: i.user.username, type: type.name, number: pad(number) }))
    .addFields({ name: 'Opened by', value: `${i.user}`, inline: true }, { name: 'Priority', value: PRIORITY.normal, inline: true }).setTimestamp();
  JSON.parse(type.questions || '[]').forEach((q, n) => embed.addFields({ name: q.slice(0, 256), value: (answers[n] || '—').slice(0, 1024) }));
  await ch.send({ content: [`${i.user}`, ...roles.map((r) => `<@&${r}>`)].join(' '), embeds: [embed], components: [ticketButtons()], allowedMentions: { users: [i.user.id], roles } });
  tlog(g, { embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('Ticket opened').setDescription(`#${pad(number)} ${ch} — ${type.name}\nBy ${i.user}`).setTimestamp()] });
  i.editReply(`✅ Your ticket: ${ch}`);
}

// ---------- claim ----------
async function doClaim(i, unclaim = false) {
  const t = byChannel(i.channelId);
  if (!t || t.status !== 'open') return i.reply({ content: 'This is not an open ticket.', flags: EPH });
  if (!isStaff(i.member, getType(t.type_id), i.guildId)) return i.reply({ content: 'Only staff can do that.', flags: EPH });
  if (unclaim || t.claimed_by === i.user.id) {
    db.prepare('UPDATE tickets SET claimed_by = NULL WHERE id = ?').run(t.id);
    return i.reply({ embeds: [new EmbedBuilder().setColor(0x95a5a6).setDescription(`${i.user} released this ticket.`)] });
  }
  if (t.claimed_by && !i.member.permissions.has(P.ManageGuild)) return i.reply({ content: `Already claimed by <@${t.claimed_by}>.`, flags: EPH });
  db.prepare('UPDATE tickets SET claimed_by = ? WHERE id = ?').run(i.user.id, t.id);
  i.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setDescription(`🙋 ${i.user} claimed this ticket and will assist you.`)] });
}

// ---------- transcripts & closing ----------
async function buildTranscript(ch, t, type) {
  const all = []; let before;
  for (let n = 0; n < 10; n++) {
    const b = await ch.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!b || !b.size) break;
    all.push(...b.values()); before = b.last().id;
  }
  all.reverse();
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = all.map((m) => `<div class="m"><img src="${esc(m.author.displayAvatarURL({ size: 64 }))}"><div><b>${esc(m.member?.displayName || m.author.username)}</b>${m.author.bot ? ' <span class="bot">BOT</span>' : ''} <time>${m.createdAt.toISOString().replace('T', ' ').slice(0, 19)} UTC</time><p>${esc(m.content).replace(/\n/g, '<br>')}</p>${m.attachments.map((a) => `<a href="${esc(a.url)}">📎 ${esc(a.name)}</a>`).join('<br>')}${m.embeds.map((e) => `<blockquote>${esc(e.title || '')} ${esc(e.description || '')}</blockquote>`).join('')}</div></div>`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ticket #${pad(t.number)}</title><style>
body{font-family:system-ui,sans-serif;background:#313338;color:#dbdee1;max-width:860px;margin:2rem auto;padding:0 1rem}
h1{font-size:1.3rem}.meta{color:#949ba4;margin-bottom:1rem}.m{display:flex;gap:.75rem;margin:.9rem 0}.m img{width:40px;height:40px;border-radius:50%}
.m p{margin:.2rem 0}time{color:#949ba4;font-size:.75rem;margin-left:.4rem}.bot{background:#5865f2;color:#fff;font-size:.65rem;padding:1px 4px;border-radius:3px}
blockquote{border-left:4px solid #4e5058;margin:.3rem 0;padding-left:.6rem;color:#b5bac1}a{color:#00a8fc}</style></head><body>
<h1>Ticket #${pad(t.number)} — ${esc(type?.name || 'ticket')}</h1>
<div class="meta">Opened ${new Date(t.created).toISOString().replace('T', ' ').slice(0, 19)} UTC • ${all.length} messages</div>
${rows || '<p>(no messages)</p>'}</body></html>`;
}

async function performClose({ client, guild, channel, t, closerId, reason }) {
  db.prepare("UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = ?, close_reason = ? WHERE id = ?").run(Date.now(), closerId, reason || null, t.id);
  t = byId(t.id);
  const type = getType(t.type_id);
  const html = await buildTranscript(channel, t, type);
  const file = () => new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `ticket-${pad(t.number)}-transcript.html` });
  const summary = new EmbedBuilder().setColor(0xe74c3c).setTitle(`Ticket #${pad(t.number)} closed`).addFields(
    { name: 'Opened by', value: `<@${t.user_id}>`, inline: true },
    { name: 'Closed by', value: closerId ? `<@${closerId}>` : 'Auto-close (inactive)', inline: true },
    { name: 'Type', value: type?.name || '—', inline: true },
    { name: 'Claimed by', value: t.claimed_by ? `<@${t.claimed_by}>` : 'Nobody', inline: true },
    { name: 'Open for', value: human(Date.now() - t.created), inline: true },
    { name: 'Priority', value: PRIORITY[t.priority] || t.priority, inline: true },
    { name: 'Reason', value: reason || 'None given' }).setTimestamp();
  tlog(guild, { embeds: [summary], files: [file()] });

  if (getSetting(guild.id, 'ticket_dm_transcript', '1') === '1') {
    const opener = await client.users.fetch(t.user_id).catch(() => null);
    if (opener) {
      const payload = { content: `Your ticket in **${guild.name}** was closed.${reason ? `\nReason: ${reason}` : ''}`, embeds: [summary], files: [file()] };
      if (getSetting(guild.id, 'ticket_ratings', '1') === '1') { payload.content += '\nHow was our support?'; payload.components = [ratingRow(t.id)]; }
      opener.send(payload).catch(() => {});
    }
  }

  const archive = validCategory(guild, getSetting(guild.id, 'ticket_archive_category'));
  if (archive) {
    for (const o of channel.permissionOverwrites.cache.values()) if (o.type === OverwriteType.Member && o.id !== client.user.id) await o.delete().catch(() => {});
    await channel.setParent(archive, { lockPermissions: false }).catch(() => {});
    await channel.setName(`closed-${pad(t.number)}`).catch(() => {});
    await channel.send({
      embeds: [new EmbedBuilder().setColor(0x95a5a6).setTitle('Ticket archived').setDescription('Staff can reopen or permanently delete this ticket.')],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tkt:reopen').setLabel('Reopen').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('tkt:delete').setLabel('Delete').setStyle(ButtonStyle.Danger))],
    }).catch(() => {});
  } else {
    setTimeout(() => channel.delete().catch(() => {}), 5000);
  }
}

async function interactiveClose(i, reason) {
  const t = byChannel(i.channelId);
  if (!t || t.status !== 'open') return i.reply({ content: 'This is not an open ticket.', flags: EPH });
  if (i.user.id !== t.user_id && !isStaff(i.member, getType(t.type_id), i.guildId)) return i.reply({ content: 'Only the ticket owner or staff can close this.', flags: EPH });
  await i.reply('🔒 Saving transcript and closing this ticket…');
  return performClose({ client: i.client, guild: i.guild, channel: i.channel, t, closerId: i.user.id, reason });
}

// ---------- button / modal / select router ----------
async function router(i) {
  const parts = i.customId.split(':'); const action = parts[1];
  if (i.isStringSelectMenu()) return beginOpen(i, Number(i.values[0]));

  if (i.isModalSubmit()) {
    if (action === 'modal') {
      const type = getType(Number(parts[2]));
      if (!type || type.guild_id !== i.guildId) return i.reply({ content: 'That ticket type no longer exists.', flags: EPH });
      const answers = JSON.parse(type.questions || '[]').map((_, n) => i.fields.getTextInputValue(`q${n}`));
      await i.deferReply({ flags: EPH });
      return createTicket(i, type, answers);
    }
    if (action === 'closemodal') return interactiveClose(i, i.fields.getTextInputValue('reason') || null);
    if (action === 'ratemodal') {
      const t = byId(Number(parts[2])); const stars = Number(parts[3]);
      if (!t || t.user_id !== i.user.id) return i.reply({ content: "That isn't your ticket.", flags: EPH });
      const feedback = i.fields.getTextInputValue('feedback') || null;
      db.prepare('UPDATE tickets SET rating = ?, feedback = ? WHERE id = ?').run(stars, feedback, t.id);
      const guild = i.client.guilds.cache.get(t.guild_id);
      if (guild) tlog(guild, { embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle(`⭐ Rating for ticket #${pad(t.number)}`)
        .setDescription(`${'⭐'.repeat(stars)} (${stars}/5) from <@${t.user_id}>\nHandled by: ${t.claimed_by ? `<@${t.claimed_by}>` : 'unclaimed'}${feedback ? `\n\n${feedback}` : ''}`).setTimestamp()] });
      const done = { content: 'Thanks for your feedback! 💙', components: [] };
      return i.isFromMessage() ? i.update(done) : i.reply(done);
    }
    return;
  }

  switch (action) {
    case 'open': return beginOpen(i, Number(parts[2]));
    case 'claim': return doClaim(i);
    case 'close': {
      const t = byChannel(i.channelId);
      if (!t || t.status !== 'open') return i.reply({ content: 'This is not an open ticket.', flags: EPH });
      if (i.user.id !== t.user_id && !isStaff(i.member, getType(t.type_id), i.guildId)) return i.reply({ content: 'Only the ticket owner or staff can close this.', flags: EPH });
      return i.showModal(closeModal());
    }
    case 'reopen': case 'delete': {
      const t = byChannel(i.channelId);
      if (!t || !isStaff(i.member, getType(t.type_id), i.guildId)) return i.reply({ content: 'Only staff can do that.', flags: EPH });
      if (action === 'delete') { await i.reply('🗑️ Deleting in 3 seconds…'); return setTimeout(() => i.channel.delete().catch(() => {}), 3000); }
      const type = getType(t.type_id);
      await i.channel.permissionOverwrites.edit(t.user_id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true }).catch(() => {});
      const parent = validCategory(i.guild, type?.category_id || getSetting(i.guildId, 'ticket_category'));
      if (parent) await i.channel.setParent(parent, { lockPermissions: false }).catch(() => {});
      await i.channel.setName(`${type?.name || 'ticket'}-${pad(t.number)}`.toLowerCase().replace(/[^a-z0-9-_]+/g, '-')).catch(() => {});
      db.prepare("UPDATE tickets SET status = 'open', closed_at = NULL, closed_by = NULL, last_activity = ?, warned = 0 WHERE id = ?").run(Date.now(), t.id);
      await i.update({ components: [] });
      return i.channel.send({ content: `<@${t.user_id}>`, embeds: [new EmbedBuilder().setColor(0x2ecc71).setDescription(`🔓 Ticket reopened by ${i.user}.`)], components: [ticketButtons()] });
    }
    case 'rate': {
      const m = new ModalBuilder().setCustomId(`tkt:ratemodal:${parts[2]}:${parts[3]}`).setTitle(`${parts[3]} star rating`).addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('feedback').setLabel('Any comments? (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)));
      return i.showModal(m);
    }
  }
}

// ---------- slash commands ----------
const need = (i) => {
  const t = byChannel(i.channelId);
  if (!t || t.status !== 'open') { i.reply({ content: 'Use this inside an open ticket.', flags: EPH }); return null; }
  return t;
};
const needStaff = (i) => {
  const t = need(i); if (!t) return null;
  if (!isStaff(i.member, getType(t.type_id), i.guildId)) { i.reply({ content: 'Only staff can do that.', flags: EPH }); return null; }
  return t;
};
const catOpt = (o) => o.addChannelTypes(ChannelType.GuildCategory);

// Builds the message for a ticket panel (used by /ticketsetup panel and the web dashboard)
function panelPayload(types, style, title, description) {
  let components;
  if (style === 'dropdown') {
    components = [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('tkt:select').setPlaceholder('Choose a ticket type…')
      .addOptions(types.slice(0, 25).map((t) => ({ label: t.name.slice(0, 100), value: String(t.id), description: (t.description || '').slice(0, 100) || undefined, emoji: parseEmoji(t.emoji) }))))];
  } else {
    components = [new ActionRowBuilder().addComponents(types.slice(0, 5).map((t) => {
      const b = new ButtonBuilder().setCustomId(`tkt:open:${t.id}`).setLabel(t.name.slice(0, 80)).setStyle(ButtonStyle.Primary);
      const em = parseEmoji(t.emoji); if (em) b.setEmoji(em);
      return b;
    }))];
  }
  return {
    embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(title || '🎫 Support')
      .setDescription((description || 'Need help? Pick an option below to open a private ticket with our staff.').replaceAll('\\n', '\n'))],
    components,
  };
}

const ticketCmd = {
  data: new SlashCommandBuilder().setName('ticket').setDescription('Manage the current ticket')
    .addSubcommand((s) => s.setName('add').setDescription('Add someone to this ticket').addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove someone from this ticket').addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommand((s) => s.setName('rename').setDescription('Rename this ticket').addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true)))
    .addSubcommand((s) => s.setName('priority').setDescription('Set priority').addStringOption((o) => o.setName('level').setDescription('Level').setRequired(true)
      .addChoices({ name: 'Low', value: 'low' }, { name: 'Normal', value: 'normal' }, { name: 'High', value: 'high' }, { name: 'Urgent', value: 'urgent' })))
    .addSubcommand((s) => s.setName('claim').setDescription('Claim this ticket'))
    .addSubcommand((s) => s.setName('unclaim').setDescription('Release this ticket'))
    .addSubcommand((s) => s.setName('move').setDescription('Move to another ticket type').addStringOption((o) => o.setName('type').setDescription('Type name').setRequired(true)))
    .addSubcommand((s) => s.setName('close').setDescription('Close this ticket').addStringOption((o) => o.setName('reason').setDescription('Reason')))
    .addSubcommand((s) => s.setName('info').setDescription('Show ticket details'))
    .addSubcommand((s) => s.setName('transcript').setDescription('Get a transcript of this ticket (staff)'))
    .addSubcommand((s) => s.setName('stats').setDescription('Ticket statistics (staff)')),
  async execute(i) {
    const sub = i.options.getSubcommand();
    if (sub === 'claim') return doClaim(i);
    if (sub === 'unclaim') return doClaim(i, true);
    if (sub === 'close') return interactiveClose(i, i.options.getString('reason'));

    if (sub === 'stats') {
      if (!i.memberPermissions.has(P.ManageMessages)) return i.reply({ content: 'Staff only.', flags: EPH });
      const g = i.guildId;
      const s = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open, AVG(rating) AS rating, COUNT(rating) AS rated, AVG(first_response - created) AS frt FROM tickets WHERE guild_id = ?").get(g);
      const top = db.prepare('SELECT claimed_by, COUNT(*) AS c FROM tickets WHERE guild_id = ? AND claimed_by IS NOT NULL GROUP BY claimed_by ORDER BY c DESC LIMIT 5').all(g);
      const types = db.prepare('SELECT ty.name, COUNT(*) AS c FROM tickets t JOIN ticket_types ty ON ty.id = t.type_id WHERE t.guild_id = ? GROUP BY ty.name ORDER BY c DESC LIMIT 8').all(g);
      return i.reply({ flags: EPH, embeds: [new EmbedBuilder().setTitle('🎫 Ticket stats').addFields(
        { name: 'Total / open', value: `${s.total} / ${s.open || 0}`, inline: true },
        { name: 'Avg rating', value: s.rated ? `${s.rating.toFixed(2)} ⭐ (${s.rated} ratings)` : 'No ratings', inline: true },
        { name: 'Avg first response', value: s.frt ? human(s.frt) : '—', inline: true },
        { name: 'Top claimers', value: top.length ? top.map((r, n) => `${n + 1}. <@${r.claimed_by}> — ${r.c}`).join('\n') : '—' },
        { name: 'By type', value: types.length ? types.map((r) => `${r.name}: ${r.c}`).join('\n') : '—' })] });
    }

    const t = sub === 'info' ? need(i) : needStaff(i);
    if (!t) return;
    const type = getType(t.type_id);

    if (sub === 'info') {
      return i.reply({ flags: EPH, embeds: [new EmbedBuilder().setTitle(`Ticket #${pad(t.number)}`).addFields(
        { name: 'Opened by', value: `<@${t.user_id}>`, inline: true }, { name: 'Type', value: type?.name || '—', inline: true },
        { name: 'Priority', value: PRIORITY[t.priority], inline: true }, { name: 'Claimed by', value: t.claimed_by ? `<@${t.claimed_by}>` : 'Nobody', inline: true },
        { name: 'Opened', value: `<t:${Math.floor(t.created / 1000)}:R>`, inline: true })] });
    }
    if (sub === 'add' || sub === 'remove') {
      const u = i.options.getUser('user');
      if (sub === 'remove') {
        if (u.id === t.user_id) return i.reply({ content: "You can't remove the ticket owner.", flags: EPH });
        await i.channel.permissionOverwrites.delete(u.id).catch(() => {});
        return i.reply(`➖ Removed ${u} from this ticket.`);
      }
      await i.channel.permissionOverwrites.edit(u.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
      return i.reply(`➕ Added ${u} to this ticket.`);
    }
    if (sub === 'rename') {
      const name = i.options.getString('name').toLowerCase().replace(/[^a-z0-9-_]+/g, '-').slice(0, 90);
      await i.channel.setName(name);
      return i.reply(`✏️ Renamed to **${name}**.`);
    }
    if (sub === 'priority') {
      const level = i.options.getString('level');
      db.prepare('UPDATE tickets SET priority = ? WHERE id = ?').run(level, t.id);
      return i.reply({ embeds: [new EmbedBuilder().setColor(0xe67e22).setDescription(`Priority set to **${PRIORITY[level]}** by ${i.user}.`)] });
    }
    if (sub === 'move') {
      const nt = typeByName(i.guildId, i.options.getString('type'));
      if (!nt) return i.reply({ content: 'No ticket type with that name.', flags: EPH });
      const oldRoles = supportRoles(type, i.guildId); const newRoles = supportRoles(nt, i.guildId).filter((r) => i.guild.roles.cache.has(r));
      for (const r of oldRoles) if (!newRoles.includes(r)) await i.channel.permissionOverwrites.delete(r).catch(() => {});
      for (const r of newRoles) await i.channel.permissionOverwrites.edit(r, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, ManageMessages: true }).catch(() => {});
      const parent = validCategory(i.guild, nt.category_id || getSetting(i.guildId, 'ticket_category'));
      if (parent) await i.channel.setParent(parent, { lockPermissions: false }).catch(() => {});
      db.prepare('UPDATE tickets SET type_id = ? WHERE id = ?').run(nt.id, t.id);
      return i.reply({ content: `${newRoles.map((r) => `<@&${r}>`).join(' ')} 🔀 Ticket moved to **${nt.name}** by ${i.user}.`, allowedMentions: { roles: newRoles } });
    }
    if (sub === 'transcript') {
      await i.deferReply({ flags: EPH });
      const html = await buildTranscript(i.channel, t, type);
      return i.editReply({ content: 'Transcript so far:', files: [new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `ticket-${pad(t.number)}-transcript.html` })] });
    }
  },
};

const setupCmd = {
  data: new SlashCommandBuilder().setName('ticketsetup').setDescription('Configure the ticket system').setDefaultMemberPermissions(P.ManageGuild)
    .addSubcommand((s) => s.setName('type-create').setDescription('Create or edit a ticket type')
      .addStringOption((o) => o.setName('name').setDescription('Type name, e.g. Support').setRequired(true))
      .addStringOption((o) => o.setName('emoji').setDescription('Emoji'))
      .addStringOption((o) => o.setName('description').setDescription('Shown in dropdown panels'))
      .addChannelOption((o) => catOpt(o.setName('category').setDescription('Category tickets are created in')))
      .addRoleOption((o) => o.setName('support_role').setDescription('Staff role that can see these tickets'))
      .addRoleOption((o) => o.setName('support_role2').setDescription('Second staff role'))
      .addRoleOption((o) => o.setName('support_role3').setDescription('Third staff role'))
      .addStringOption((o) => o.setName('welcome').setDescription('Welcome text. Use {user} {username} {type} {number}'))
      .addStringOption((o) => o.setName('questions').setDescription('Up to 5 questions asked before opening, separated by |'))
      .addIntegerOption((o) => o.setName('max_open').setDescription('Max open tickets per user of this type (default 1)').setMinValue(1).setMaxValue(10))
      .addStringOption((o) => o.setName('naming').setDescription('Channel name template, e.g. {type}-{username}-{number}')))
    .addSubcommand((s) => s.setName('type-delete').setDescription('Delete a ticket type').addStringOption((o) => o.setName('name').setDescription('Type name').setRequired(true)))
    .addSubcommand((s) => s.setName('types').setDescription('List ticket types'))
    .addSubcommand((s) => s.setName('panel').setDescription('Post a ticket panel in this channel')
      .addStringOption((o) => o.setName('types').setDescription('Type names, comma separated').setRequired(true))
      .addStringOption((o) => o.setName('style').setDescription('Buttons (max 5) or dropdown').addChoices({ name: 'Buttons', value: 'buttons' }, { name: 'Dropdown', value: 'dropdown' }))
      .addStringOption((o) => o.setName('title').setDescription('Panel title'))
      .addStringOption((o) => o.setName('description').setDescription('Panel text')))
    .addSubcommand((s) => s.setName('settings').setDescription('View or change ticket settings')
      .addChannelOption((o) => o.setName('log_channel').setDescription('Ticket log + transcripts channel'))
      .addChannelOption((o) => catOpt(o.setName('archive_category').setDescription('Closed tickets move here instead of being deleted')))
      .addChannelOption((o) => catOpt(o.setName('default_category').setDescription('Default category for ticket types without one')))
      .addRoleOption((o) => o.setName('default_support_role').setDescription('Staff role for every ticket type'))
      .addIntegerOption((o) => o.setName('autoclose_hours').setDescription('Auto-close after this many idle hours (0 = off)').setMinValue(0).setMaxValue(720))
      .addBooleanOption((o) => o.setName('ratings').setDescription('Ask users to rate support after closing'))
      .addBooleanOption((o) => o.setName('dm_transcript').setDescription('DM the transcript to the ticket owner')))
    .addSubcommand((s) => s.setName('blacklist').setDescription('Block or unblock someone from opening tickets')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
      .addBooleanOption((o) => o.setName('blocked').setDescription('Block (true) or unblock (false)').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason'))),
  async execute(i) {
    const g = i.guildId; const sub = i.options.getSubcommand();
    if (sub === 'type-create') {
      const name = i.options.getString('name').trim().slice(0, 40);
      const old = typeByName(g, name) || {};
      const roles = ['support_role', 'support_role2', 'support_role3'].map((k) => i.options.getRole(k)?.id).filter(Boolean);
      const qs = i.options.getString('questions');
      const v = {
        emoji: i.options.getString('emoji') ?? old.emoji ?? null,
        description: i.options.getString('description') ?? old.description ?? null,
        category: i.options.getChannel('category')?.id ?? old.category_id ?? null,
        roles: roles.length ? roles.join(',') : old.support_roles ?? '',
        welcome: i.options.getString('welcome') ?? old.welcome ?? null,
        questions: qs ? JSON.stringify(qs.split('|').map((q) => q.trim().slice(0, 45)).filter(Boolean).slice(0, 5)) : old.questions ?? '[]',
        max: i.options.getInteger('max_open') ?? old.max_open ?? 1,
        naming: i.options.getString('naming') ?? old.naming ?? null,
      };
      db.prepare(`INSERT INTO ticket_types (guild_id, name, emoji, description, category_id, support_roles, welcome, questions, max_open, naming) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (guild_id, name) DO UPDATE SET emoji = excluded.emoji, description = excluded.description, category_id = excluded.category_id, support_roles = excluded.support_roles,
        welcome = excluded.welcome, questions = excluded.questions, max_open = excluded.max_open, naming = excluded.naming`)
        .run(g, name, v.emoji, v.description, v.category, v.roles, v.welcome, v.questions, v.max, v.naming);
      return i.reply({ content: `✅ Ticket type **${name}** saved. Add it to a panel with \`/ticketsetup panel types:${name}\`.`, flags: EPH });
    }
    if (sub === 'type-delete') {
      const r = db.prepare('DELETE FROM ticket_types WHERE guild_id = ? AND lower(name) = ?').run(g, i.options.getString('name').trim().toLowerCase());
      return i.reply({ content: r.changes ? '🗑️ Deleted. Existing panels with it will say the type no longer exists.' : 'No such type.', flags: EPH });
    }
    if (sub === 'types') {
      const rows = db.prepare('SELECT * FROM ticket_types WHERE guild_id = ?').all(g);
      const text = rows.map((t) => `${t.emoji || '🎫'} **${t.name}** — ${JSON.parse(t.questions || '[]').length} questions, max ${t.max_open} open, staff: ${supportRoles(t, g).map((r) => `<@&${r}>`).join(' ') || 'none'}${t.category_id ? `, <#${t.category_id}>` : ''}`).join('\n');
      return i.reply({ embeds: [new EmbedBuilder().setTitle('Ticket types').setDescription(text || 'None yet. Create one with `/ticketsetup type-create`.')], flags: EPH });
    }
    if (sub === 'panel') {
      const wanted = i.options.getString('types').split(',').map((s) => s.trim()).filter(Boolean);
      const types = wanted.map((n) => typeByName(g, n)).filter(Boolean);
      if (!types.length) return i.reply({ content: 'None of those types exist. Use `/ticketsetup types`.', flags: EPH });
      await i.channel.send(panelPayload(types, i.options.getString('style') || 'buttons', i.options.getString('title'), i.options.getString('description')));
      return i.reply({ content: '✅ Panel posted.', flags: EPH });
    }
    if (sub === 'blacklist') {
      const u = i.options.getUser('user');
      if (i.options.getBoolean('blocked')) db.prepare('INSERT INTO ticket_blacklist VALUES (?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET reason = excluded.reason').run(g, u.id, i.options.getString('reason'));
      else db.prepare('DELETE FROM ticket_blacklist WHERE guild_id = ? AND user_id = ?').run(g, u.id);
      return i.reply({ content: `✅ ${u.tag} ${i.options.getBoolean('blocked') ? 'can no longer open tickets' : 'can open tickets again'}.`, flags: EPH });
    }
    // settings
    const map = [['log_channel', 'ticket_log_channel', (o) => o.id], ['archive_category', 'ticket_archive_category', (o) => o.id], ['default_category', 'ticket_category', (o) => o.id],
      ['default_support_role', 'ticket_support_role', (o) => o.id]];
    for (const [opt, key, f] of map) { const v = opt.includes('role') ? i.options.getRole(opt) : i.options.getChannel(opt); if (v) setSetting(g, key, f(v)); }
    if (i.options.getInteger('autoclose_hours') !== null) setSetting(g, 'ticket_autoclose_hours', i.options.getInteger('autoclose_hours'));
    if (i.options.getBoolean('ratings') !== null) setSetting(g, 'ticket_ratings', i.options.getBoolean('ratings') ? '1' : '0');
    if (i.options.getBoolean('dm_transcript') !== null) setSetting(g, 'ticket_dm_transcript', i.options.getBoolean('dm_transcript') ? '1' : '0');
    const c = (k) => (getSetting(g, k) ? `<#${getSetting(g, k)}>` : 'not set');
    i.reply({ flags: EPH, embeds: [new EmbedBuilder().setTitle('🎫 Ticket settings').setDescription(
      `Log channel: ${c('ticket_log_channel')}\nArchive category: ${c('ticket_archive_category')}\nDefault category: ${c('ticket_category')}\n` +
      `Default staff role: ${getSetting(g, 'ticket_support_role') ? `<@&${getSetting(g, 'ticket_support_role')}>` : 'not set'}\n` +
      `Auto-close: ${Number(getSetting(g, 'ticket_autoclose_hours', 0)) || 'off'}${Number(getSetting(g, 'ticket_autoclose_hours', 0)) ? ' hours idle' : ''}\n` +
      `Ratings: ${getSetting(g, 'ticket_ratings', '1') === '1' ? 'on' : 'off'}\nDM transcripts: ${getSetting(g, 'ticket_dm_transcript', '1') === '1' ? 'on' : 'off'}`)] });
  },
};

module.exports = {
  api: { panelPayload },
  commands: [ticketCmd, setupCmd],
  buttons: [{ prefix: 'tkt:', execute: router }],
  events: [{
    name: Events.MessageCreate,
    execute(msg) {
      if (!msg.guild || msg.author.bot) return;
      const t = byChannel(msg.channelId);
      if (!t || t.status !== 'open') return;
      const now = Date.now();
      db.prepare('UPDATE tickets SET last_activity = ?, warned = 0 WHERE id = ?').run(now, t.id);
      if (!t.first_response && msg.author.id !== t.user_id) db.prepare('UPDATE tickets SET first_response = ? WHERE id = ?').run(now, t.id);
    },
  }],
  init(client) {
    setInterval(async () => {
      const open = db.prepare("SELECT * FROM tickets WHERE status = 'open' AND channel_id IS NOT NULL").all();
      for (const t of open) {
        const hrs = Number(getSetting(t.guild_id, 'ticket_autoclose_hours', 0));
        const guild = client.guilds.cache.get(t.guild_id);
        if (!hrs || !guild) continue;
        const ch = guild.channels.cache.get(t.channel_id);
        if (!ch) { db.prepare("UPDATE tickets SET status = 'closed', closed_at = ?, close_reason = 'Channel deleted' WHERE id = ?").run(Date.now(), t.id); continue; }
        const idle = Date.now() - t.last_activity; const limit = hrs * 36e5;
        if (idle >= limit) {
          await ch.send('⏰ Closing this ticket due to inactivity.').catch(() => {});
          await performClose({ client, guild, channel: ch, t, closerId: null, reason: `Inactive for ${hrs}h` }).catch(console.error);
        } else if (idle >= limit * 0.8 && !t.warned) {
          db.prepare('UPDATE tickets SET warned = 1 WHERE id = ?').run(t.id);
          ch.send(`⏰ <@${t.user_id}> this ticket will auto-close <t:${Math.floor((t.last_activity + limit) / 1000)}:R> unless someone replies.`).catch(() => {});
        }
      }
    }, 10 * 60 * 1000);
  },
};
