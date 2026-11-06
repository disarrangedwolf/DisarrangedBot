const { MessageFlags, PermissionFlagsBits: P, OAuth2Scopes } = require('discord.js');
const { getSetting } = require('./db');

const EPH = MessageFlags.Ephemeral;

// "10m", "2h", "3d", "1w" -> milliseconds
function parseDuration(s) {
  const m = /^(\d+)\s*(s|m|h|d|w)$/i.exec((s || '').trim());
  if (!m) return null;
  const unit = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 };
  return Number(m[1]) * unit[m[2].toLowerCase()];
}

// Send an embed to the configured log channel (if any)
async function log(guild, embed) {
  const id = getSetting(guild.id, 'log_channel');
  const ch = id && guild.channels.cache.get(id);
  if (ch) ch.send({ embeds: [embed] }).catch(() => {});
}

// Mention text + matching allowedMentions for a role id (or @everyone when roleId is the guild id)
function pingOf(guildId, roleId) {
  if (!roleId) return { text: '', allowed: { parse: [] } };
  if (roleId === guildId) return { text: '@everyone', allowed: { parse: ['everyone'] } };
  return { text: `<@&${roleId}>`, allowed: { roles: [roleId] } };
}
const fmtText = (t, v) => t.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);

const INVITE_PERMS = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory, P.AddReactions, P.UseExternalEmojis,
  P.ManageMessages, P.ManageChannels, P.ManageRoles, P.KickMembers, P.BanMembers, P.ModerateMembers, P.ViewAuditLog];
const inviteUrl = (client) => client.generateInvite({ scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands], permissions: INVITE_PERMS });

module.exports = { EPH, parseDuration, log, pingOf, fmtText, inviteUrl };
