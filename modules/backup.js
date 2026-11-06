const { SlashCommandBuilder, PermissionFlagsBits: P, ChannelType, OverwriteType, EmbedBuilder } = require('discord.js');
const { db } = require('../db');
const { EPH } = require('../utils');

db.exec('CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, name TEXT, ts INTEGER, data TEXT)');

function snapshot(guild) {
  const roles = guild.roles.cache.filter((r) => !r.managed).sort((a, b) => a.position - b.position).map((r) => ({
    id: r.id, name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable,
    permissions: r.permissions.bitfield.toString(), everyone: r.id === guild.id,
  }));
  const channels = [...guild.channels.cache.values()].filter((c) => !c.isThread()).sort((a, b) => a.rawPosition - b.rawPosition).map((c) => ({
    id: c.id, name: c.name, type: c.type, parent: c.parentId, topic: c.topic ?? null, nsfw: c.nsfw ?? false,
    slowmode: c.rateLimitPerUser ?? 0, userLimit: c.userLimit ?? 0,
    overwrites: [...c.permissionOverwrites.cache.values()].filter((o) => o.type === OverwriteType.Role)
      .map((o) => ({ id: o.id, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })),
  }));
  return { roles, channels };
}

async function restore(guild, data, wipe) {
  const stats = { roles: 0, channels: 0, failed: 0 };
  if (wipe) {
    for (const c of guild.channels.cache.values()) await c.delete('Backup restore').catch(() => {});
    for (const r of guild.roles.cache.values()) if (!r.managed && r.id !== guild.id && r.editable) await r.delete('Backup restore').catch(() => {});
  }
  const roleMap = new Map();
  for (const r of data.roles) {
    if (r.everyone) { roleMap.set(r.id, guild.roles.everyone.id); await guild.roles.everyone.setPermissions(BigInt(r.permissions)).catch(() => {}); continue; }
    const existing = guild.roles.cache.find((x) => x.name === r.name && !x.managed);
    if (existing) { roleMap.set(r.id, existing.id); continue; }
    const made = await guild.roles.create({ name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: BigInt(r.permissions), reason: 'Backup restore' }).catch(() => null);
    if (made) { roleMap.set(r.id, made.id); stats.roles++; } else stats.failed++;
  }
  const chMap = new Map();
  const ordered = [...data.channels.filter((c) => c.type === ChannelType.GuildCategory), ...data.channels.filter((c) => c.type !== ChannelType.GuildCategory)];
  for (const c of ordered) {
    const parentId = c.parent ? chMap.get(c.parent) : null;
    const existing = guild.channels.cache.find((x) => x.name === c.name && x.type === c.type && (x.parentId || null) === (parentId || null));
    if (existing) { chMap.set(c.id, existing.id); continue; }
    const opts = {
      name: c.name, type: c.type, parent: parentId || undefined, reason: 'Backup restore',
      permissionOverwrites: c.overwrites.filter((o) => roleMap.has(o.id)).map((o) => ({ id: roleMap.get(o.id), allow: BigInt(o.allow), deny: BigInt(o.deny) })),
    };
    if (c.type === ChannelType.GuildText) { opts.topic = c.topic || undefined; opts.nsfw = c.nsfw; opts.rateLimitPerUser = c.slowmode; }
    if (c.type === ChannelType.GuildVoice) opts.userLimit = c.userLimit;
    const made = await guild.channels.create(opts).catch(() => null);
    if (made) { chMap.set(c.id, made.id); stats.channels++; } else stats.failed++;
  }
  return stats;
}

module.exports = {
  commands: [{
    data: new SlashCommandBuilder().setName('backup').setDescription('Back up and restore roles and channels').setDefaultMemberPermissions(P.Administrator)
      .addSubcommand((s) => s.setName('create').setDescription('Save a snapshot now').addStringOption((o) => o.setName('name').setDescription('Label')))
      .addSubcommand((s) => s.setName('list').setDescription('List backups'))
      .addSubcommand((s) => s.setName('delete').setDescription('Delete a backup').addIntegerOption((o) => o.setName('id').setDescription('Backup ID').setRequired(true)))
      .addSubcommand((s) => s.setName('restore').setDescription('Restore a backup (adds anything missing)')
        .addIntegerOption((o) => o.setName('id').setDescription('Backup ID').setRequired(true))
        .addBooleanOption((o) => o.setName('wipe').setDescription('DELETE all current channels and roles first (owner only)'))
        .addStringOption((o) => o.setName('confirm').setDescription('Type RESTORE to confirm a wipe'))),
    async execute(i) {
      const g = i.guild; const sub = i.options.getSubcommand();
      if (sub === 'create') {
        const snap = snapshot(g);
        const id = db.prepare('INSERT INTO backups (guild_id, name, ts, data) VALUES (?, ?, ?, ?)')
          .run(g.id, i.options.getString('name') || 'backup', Date.now(), JSON.stringify(snap)).lastInsertRowid;
        const old = db.prepare('SELECT id FROM backups WHERE guild_id = ? ORDER BY id DESC LIMIT -1 OFFSET 10').all(g.id);
        for (const o of old) db.prepare('DELETE FROM backups WHERE id = ?').run(o.id);
        return i.reply({ content: `✅ Backup **#${id}** saved (${snap.roles.length} roles, ${snap.channels.length} channels).`, flags: EPH });
      }
      if (sub === 'list') {
        const rows = db.prepare('SELECT id, name, ts FROM backups WHERE guild_id = ? ORDER BY id DESC').all(g.id);
        return i.reply({ flags: EPH, embeds: [new EmbedBuilder().setTitle('Backups').setDescription(rows.length ? rows.map((r) => `**#${r.id}** ${r.name} — <t:${Math.floor(r.ts / 1000)}:R>`).join('\n') : 'None yet. Keeps the 10 most recent.')] });
      }
      const row = db.prepare('SELECT * FROM backups WHERE id = ? AND guild_id = ?').get(i.options.getInteger('id'), g.id);
      if (!row) return i.reply({ content: 'No backup with that ID in this server.', flags: EPH });
      if (sub === 'delete') { db.prepare('DELETE FROM backups WHERE id = ?').run(row.id); return i.reply({ content: '🗑️ Deleted.', flags: EPH }); }

      const wipe = i.options.getBoolean('wipe') || false;
      if (wipe && (i.user.id !== g.ownerId || i.options.getString('confirm') !== 'RESTORE'))
        return i.reply({ content: '❌ A wipe restore can only be run by the server owner, with `confirm:RESTORE`.', flags: EPH });
      await i.deferReply({ flags: EPH });
      const stats = await restore(g, JSON.parse(row.data), wipe);
      i.editReply(`✅ Restored: ${stats.roles} roles and ${stats.channels} channels created, ${stats.failed} failed.`).catch(() => {});
    },
  }],
};
