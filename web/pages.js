const { ChannelType, PermissionFlagsBits: P, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { db, getSetting, setSetting } = require('../db');
const { esc, row, section, form, inlineForm } = require('./ui');
const tickets = require('../modules/tickets').api;
const alerts = require('../modules/alerts').api;
const feeds = require('../modules/feeds').api;

class UserError extends Error {}
const fail = (m) => { throw new UserError(m); };
const LIMIT = { tags: 50, responders: 50, types: 25, forms: 10, levelRoles: 25 };
const NO_PERMS = "I couldn't post there. Check that I can view and send messages in that channel.";
const arr = (v) => [].concat(v ?? []);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const count = (sql, g) => db.prepare(sql).get(g).c;

function buildCtx(guild, csrf) {
  const all = [...guild.channels.cache.values()];
  const text = all.filter((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type)).sort((a, b) => a.rawPosition - b.rawPosition);
  const cats = all.filter((c) => c.type === ChannelType.GuildCategory).sort((a, b) => a.rawPosition - b.rawPosition);
  const roles = [...guild.roles.cache.values()].filter((r) => r.id !== guild.id && !r.managed).sort((a, b) => b.position - a.position);
  const names = new Map(all.map((c) => [c.id, c.name]));
  return {
    guild, csrf,
    channels: text.map((c) => [c.id, c.name]), categories: cats.map((c) => [c.id, c.name]), roles: roles.map((r) => [r.id, r.name]),
    channelIds: new Set(text.map((c) => c.id)), categoryIds: new Set(cats.map((c) => c.id)), roleIds: new Set(roles.map((r) => r.id)),
    chName: (id) => (names.get(id) ? `#${names.get(id)}` : 'deleted channel'),
    roleName: (id) => { const r = guild.roles.cache.get(id); return r ? `@${r.name}` : 'none'; },
  };
}

// ----- generic settings forms (the same keys the bot commands use) -----
const flat = (sections) => sections.flatMap((s) => s.fields);
const defaultOf = (f) => String(f.def ?? (f.type === 'toggle' ? '0' : ''));
const settingsBlocks = (ctx, sections) => sections.map((s) => section(s.title, s.intro,
  s.fields.map((f) => row(f, getSetting(ctx.guild.id, f.key, defaultOf(f)), ctx)).join(''))).join('');

function saveFields(ctx, fields, body) {
  const g = ctx.guild.id;
  for (const f of fields) {
    const raw = body[f.key];
    let v;
    switch (f.type) {
      case 'toggle': v = raw === 'on' ? '1' : '0'; break;
      case 'channel': v = ctx.channelIds.has(raw) ? raw : ''; break;
      case 'category': v = ctx.categoryIds.has(raw) ? raw : ''; break;
      case 'role': v = ctx.roleIds.has(raw) ? raw : ''; break;
      case 'number': { let n = parseInt(raw, 10); if (Number.isNaN(n)) n = f.def ?? 0; v = String(clamp(n, f.min ?? 0, f.max ?? 1e6)); break; }
      case 'select': v = f.options.some(([o]) => o === raw) ? raw : String(f.def); break;
      case 'ids': v = String(raw || '').split(/[,\s]+/).filter((x) => /^\d{5,25}$/.test(x)).slice(0, 50).join(','); break;
      default: v = String(raw ?? '').replace(/\r\n/g, '\n').slice(0, f.max ?? 1900);
    }
    setSetting(g, f.key, v);
  }
}
const settingsPage = (id, title, sections, extra = '') => ({
  id, title,
  render: (ctx) => `<h1>${esc(title)}</h1>${form(ctx, 'save', settingsBlocks(ctx, sections))}${typeof extra === 'function' ? extra(ctx) : extra}`,
  actions: { save: (ctx, body) => { saveFields(ctx, flat(sections), body); return 'Saved.'; } },
});
const mini = (ctx, id, key, label, type, value, extra = {}) => row({ key, label, type, id: `${id}-${key}`, ...extra }, value, ctx);

// ================= overview =================
const NEED = [['Manage Roles', 'ManageRoles', 'Auto-roles, role panels, verification'], ['Manage Channels', 'ManageChannels', 'Tickets, stat channels, lock'],
  ['Manage Messages', 'ManageMessages', 'AutoMod, purge'], ['Kick Members', 'KickMembers', 'Kick, raid mode'], ['Ban Members', 'BanMembers', 'Ban, honeypot'],
  ['Moderate Members', 'ModerateMembers', 'Timeouts, warnings'], ['View Audit Log', 'ViewAuditLog', 'Anti-nuke'], ['Embed Links', 'EmbedLinks', 'Alerts, feeds, panels'],
  ['Add Reactions', 'AddReactions', 'Polls, giveaways, counting'], ['Attach Files', 'AttachFiles', 'Ticket transcripts']];

const overview = {
  id: 'overview', title: 'Overview',
  render(ctx) {
    const g = ctx.guild.id; const me = ctx.guild.members.me;
    const above = me ? ctx.guild.roles.cache.filter((r) => r.position > me.roles.highest.position).size : 0;
    const perms = NEED.map(([label, key, why]) => {
      const ok = me?.permissions.has(P[key]);
      return `<tr><td>${esc(label)}</td><td class="${ok ? 'good' : 'bad'}">${ok ? 'Granted' : 'Missing'}</td><td>${esc(why)}</td></tr>`;
    }).join('');
    return `<h1>Overview</h1>
<section class="block"><h2>This server</h2><table class="list"><tbody>
<tr><td>Members</td><td>${ctx.guild.memberCount}</td></tr>
<tr><td>Open tickets</td><td>${count("SELECT COUNT(*) c FROM tickets WHERE guild_id = ? AND status = 'open'", g)}</td></tr>
<tr><td>Tracked streamers</td><td>${count('SELECT COUNT(*) c FROM live_alerts WHERE guild_id = ?', g)}</td></tr>
<tr><td>Followed feeds</td><td>${count('SELECT COUNT(*) c FROM feeds WHERE guild_id = ?', g)}</td></tr></tbody></table></section>
<section class="block"><h2>Bot permissions</h2><p class="intro">Anything marked Missing disables the features listed next to it. Change this in Server Settings, then Roles.</p>
<table class="list"><thead><tr><th>Permission</th><th>Status</th><th>Used for</th></tr></thead><tbody>${perms}</tbody></table>
${above ? `<p class="intro">${above} role${above === 1 ? '' : 's'} sit above the bot's role. The bot can't manage those roles, so drag its role higher if auto-roles, role panels or timeouts fail.</p>` : ''}</section>`;
  },
};

// ================= general =================
const GENERAL = [
  { title: 'Logging', intro: 'Deleted and edited messages, joins, leaves, bans, AutoMod and security events.', fields: [
    { key: 'log_channel', type: 'channel', label: 'Log channel' }] },
  { title: 'Welcome and goodbye', fields: [
    { key: 'welcome_channel', type: 'channel', label: 'Welcome channel' },
    { key: 'welcome_message', type: 'textarea', label: 'Welcome message', def: 'Welcome {user} to **{server}**! You are member #{count}. 🎉', help: 'You can use {user} {username} {server} {count}.', max: 1000 },
    { key: 'goodbye_channel', type: 'channel', label: 'Goodbye channel' },
    { key: 'goodbye_message', type: 'textarea', label: 'Goodbye message', def: '**{username}** has left the server. 👋', max: 1000 },
    { key: 'autorole', type: 'role', label: 'Role for new members', help: "The bot's role must be above this role." }] },
];

// ================= moderation & security =================
const MOD = [
  { title: 'AutoMod', intro: 'Members with Manage Messages are never affected.', fields: [
    { key: 'automod_spam', type: 'toggle', label: 'Block spam', help: '6 messages in 5 seconds: message deleted and a 5-minute timeout.' },
    { key: 'automod_invites', type: 'toggle', label: 'Block Discord invites' },
    { key: 'automod_caps', type: 'toggle', label: 'Block excessive caps', help: 'Messages over 70% capitals (12 or more letters).' },
    { key: 'automod_mentions', type: 'toggle', label: 'Block mass mentions', help: '5 or more mentions in one message, plus a 5-minute timeout.' },
    { key: 'automod_words', type: 'toggle', label: 'Block bad words' },
    { key: 'badwords', type: 'textarea', label: 'Bad words', help: 'Separate words with commas.', max: 1500 }] },
  { title: 'Raid and nuke protection', fields: [
    { key: 'antiraid', type: 'toggle', label: 'Anti-raid', help: 'When many people join at once, new joiners are kicked for 10 minutes.' },
    { key: 'raid_threshold', type: 'number', label: 'Raid trigger', def: 5, min: 3, max: 50, help: 'Joins within 10 seconds that start raid mode.' },
    { key: 'min_account_age', type: 'number', label: 'Minimum account age (days)', def: 0, min: 0, max: 365, help: '0 turns this off. Younger accounts are kicked when they join.' },
    { key: 'antinuke', type: 'toggle', label: 'Anti-nuke', help: 'Removes roles from anyone who deletes 3 or more channels or roles, or bans 4 or more people, within 15 seconds.' },
    { key: 'nuke_whitelist', type: 'ids', label: 'Trusted user IDs', help: 'Never punished by anti-nuke. Separate IDs with commas.', max: 1000 }] },
  { title: 'Honeypot', intro: 'Anyone who posts in this channel is removed automatically. Staff with Manage Messages are exempt.', fields: [
    { key: 'honeypot_channel', type: 'channel', label: 'Honeypot channel' },
    { key: 'honeypot_action', type: 'select', label: 'Action', def: 'ban', options: [['ban', 'Ban and delete the last hour of messages'], ['kick', 'Kick']] }] },
];
const moderation = {
  ...settingsPage('moderation', 'Moderation and security', MOD, (ctx) => `<section class="block"><h2>Honeypot warning</h2>
<p class="intro">Post the "do not post here" notice in the honeypot channel so real members don't trigger it by accident.</p>${inlineForm(ctx, 'honeypot_warn', {}, 'Post warning in honeypot channel', 'btn ghost')}</section>`),
};
moderation.actions.honeypot_warn = async (ctx) => {
  const ch = ctx.guild.channels.cache.get(getSetting(ctx.guild.id, 'honeypot_channel'));
  if (!ch) fail('Choose and save a honeypot channel first.');
  const action = getSetting(ctx.guild.id, 'honeypot_action', 'ban') === 'ban' ? 'banned' : 'kicked';
  await ch.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('⚠️ DO NOT POST IN THIS CHANNEL')
    .setDescription(`Anyone who sends a message here is automatically ${action}. This catches hacked accounts and spam bots.`)] }).catch(() => fail(NO_PERMS));
  return 'Warning posted.';
};

// ================= levels =================
const LEVELS = [{ title: 'Announcements', fields: [{ key: 'levelup_channel', type: 'channel', label: 'Level-up channel', help: 'Leave unset to announce in the channel where the member was chatting.' }] }];
const levels = {
  ...settingsPage('levels', 'Levels', LEVELS, (ctx) => {
    const rows = db.prepare('SELECT level, role_id FROM level_roles WHERE guild_id = ? ORDER BY level').all(ctx.guild.id);
    const list = rows.length
      ? `<table class="list"><thead><tr><th>Level</th><th>Role</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.level}</td><td>${esc(ctx.roleName(r.role_id))}</td><td>${inlineForm(ctx, 'role_del', { level: r.level }, 'Remove')}</td></tr>`).join('')}</tbody></table>`
      : '<p class="empty">No level roles yet.</p>';
    return section('Level roles', 'Members receive the role when they reach the level.', list +
      form(ctx, 'role_add', mini(ctx, 'lr', 'level', 'Level', 'number', '5', { min: 1, max: 200 }) + mini(ctx, 'lr', 'role', 'Role', 'role', ''), 'Add level role'));
  }),
};
levels.actions.role_add = (ctx, body) => {
  const level = parseInt(body.level, 10);
  if (!(level >= 1 && level <= 200)) fail('Level must be between 1 and 200.');
  if (!ctx.roleIds.has(body.role)) fail('Choose a role.');
  const g = ctx.guild.id;
  if (!db.prepare('SELECT 1 FROM level_roles WHERE guild_id = ? AND level = ?').get(g, level) && count('SELECT COUNT(*) c FROM level_roles WHERE guild_id = ?', g) >= LIMIT.levelRoles) fail(`Up to ${LIMIT.levelRoles} level roles.`);
  db.prepare('INSERT INTO level_roles VALUES (?, ?, ?) ON CONFLICT (guild_id, level) DO UPDATE SET role_id = excluded.role_id').run(g, level, body.role);
  return `Level ${level} role saved.`;
};
levels.actions.role_del = (ctx, body) => { db.prepare('DELETE FROM level_roles WHERE guild_id = ? AND level = ?').run(ctx.guild.id, parseInt(body.level, 10)); return 'Removed.'; };

// ================= community =================
const COMMUNITY = [
  { title: 'Counting', intro: 'Members count up one number at a time. Nobody can count twice in a row.', fields: [{ key: 'counting_channel', type: 'channel', label: 'Counting channel' }] },
  { title: 'Starboard', fields: [
    { key: 'starboard_channel', type: 'channel', label: 'Starboard channel' },
    { key: 'starboard_threshold', type: 'number', label: 'Stars needed', def: 3, min: 1, max: 25 }] },
  { title: 'Suggestions', fields: [{ key: 'suggestion_channel', type: 'channel', label: 'Suggestions channel', help: 'Where /suggest posts go. Unset posts in the current channel.' }] },
];
const community = settingsPage('community', 'Community', COMMUNITY, (ctx) => section('Counting game', `Current count: ${getSetting(ctx.guild.id, 'count_current', 0)}, record: ${getSetting(ctx.guild.id, 'count_high', 0)}.`,
  inlineForm(ctx, 'reset_count', {}, 'Reset count to 0', 'btn ghost')));
community.actions.reset_count = (ctx) => { setSetting(ctx.guild.id, 'count_current', 0); setSetting(ctx.guild.id, 'count_last_user', ''); return 'Count reset.'; };

// ================= custom commands =================
const commands = {
  id: 'commands', title: 'Tags and auto-replies',
  render(ctx) {
    const g = ctx.guild.id;
    const tags = db.prepare('SELECT name, content FROM tags WHERE guild_id = ? ORDER BY name').all(g);
    const resp = db.prepare('SELECT word, response FROM autoresponders WHERE guild_id = ? ORDER BY word').all(g);
    const t1 = tags.length ? `<table class="list"><thead><tr><th>Name</th><th>Text</th><th></th></tr></thead><tbody>${tags.map((t) => `<tr><td>/tag get ${esc(t.name)}</td><td>${esc(t.content.slice(0, 120))}</td><td>${inlineForm(ctx, 'tag_del', { name: t.name }, 'Delete')}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No tags yet.</p>';
    const t2 = resp.length ? `<table class="list"><thead><tr><th>When someone says</th><th>I reply</th><th></th></tr></thead><tbody>${resp.map((t) => `<tr><td>${esc(t.word)}</td><td>${esc(t.response.slice(0, 120))}</td><td>${inlineForm(ctx, 'resp_del', { word: t.word }, 'Delete')}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No auto-replies yet.</p>';
    return `<h1>Tags and auto-replies</h1>
${section('Tags', 'Saved snippets anyone can show with /tag get.', t1 + form(ctx, 'tag_add', mini(ctx, 'tg', 'name', 'Name', 'text', '', { help: 'Letters, numbers, - and _ only.', max: 32 }) + mini(ctx, 'tg', 'content', 'Text', 'textarea', ''), 'Save tag'))}
${section('Auto-replies', 'The bot replies when a message contains the word or phrase (at most once every 10 seconds per channel).', t2 + form(ctx, 'resp_add', mini(ctx, 'ar', 'word', 'Trigger word or phrase', 'text', '', { max: 50 }) + mini(ctx, 'ar', 'response', 'Reply', 'textarea', ''), 'Save auto-reply'))}`;
  },
  actions: {
    tag_add(ctx, b) {
      const name = String(b.name || '').trim().toLowerCase(); const content = String(b.content || '').trim().slice(0, 1900); const g = ctx.guild.id;
      if (!/^[a-z0-9_-]{1,32}$/.test(name)) fail('Tag names use letters, numbers, - and _ (up to 32 characters).');
      if (!content) fail('Write the text for the tag.');
      if (!db.prepare('SELECT 1 FROM tags WHERE guild_id = ? AND name = ?').get(g, name) && count('SELECT COUNT(*) c FROM tags WHERE guild_id = ?', g) >= LIMIT.tags) fail(`Up to ${LIMIT.tags} tags.`);
      db.prepare('INSERT INTO tags VALUES (?, ?, ?) ON CONFLICT (guild_id, name) DO UPDATE SET content = excluded.content').run(g, name, content);
      return `Tag "${name}" saved.`;
    },
    tag_del: (ctx, b) => { db.prepare('DELETE FROM tags WHERE guild_id = ? AND name = ?').run(ctx.guild.id, String(b.name)); return 'Deleted.'; },
    resp_add(ctx, b) {
      const word = String(b.word || '').trim().toLowerCase().slice(0, 50); const response = String(b.response || '').trim().slice(0, 1900); const g = ctx.guild.id;
      if (!word || !response) fail('Fill in both the trigger and the reply.');
      if (!db.prepare('SELECT 1 FROM autoresponders WHERE guild_id = ? AND word = ?').get(g, word) && count('SELECT COUNT(*) c FROM autoresponders WHERE guild_id = ?', g) >= LIMIT.responders) fail(`Up to ${LIMIT.responders} auto-replies.`);
      db.prepare('INSERT INTO autoresponders VALUES (?, ?, ?) ON CONFLICT (guild_id, word) DO UPDATE SET response = excluded.response').run(g, word, response);
      return 'Auto-reply saved.';
    },
    resp_del: (ctx, b) => { db.prepare('DELETE FROM autoresponders WHERE guild_id = ? AND word = ?').run(ctx.guild.id, String(b.word)); return 'Deleted.'; },
  },
};

// ================= tickets =================
const TICKETS = [{ title: 'Ticket settings', fields: [
  { key: 'ticket_log_channel', type: 'channel', label: 'Ticket log channel', help: 'Opened and closed tickets, transcripts and ratings. Falls back to the main log channel.' },
  { key: 'ticket_archive_category', type: 'category', label: 'Archive category', help: 'Closed tickets move here instead of being deleted. Staff can reopen or delete them.' },
  { key: 'ticket_category', type: 'category', label: 'Default category', help: 'Used by ticket types that have no category of their own.' },
  { key: 'ticket_support_role', type: 'role', label: 'Staff role for every ticket' },
  { key: 'ticket_autoclose_hours', type: 'number', label: 'Auto-close after idle hours', def: 0, min: 0, max: 720, help: '0 turns this off. People get a warning at 80% of the time.' },
  { key: 'ticket_ratings', type: 'toggle', label: 'Ask for a rating after closing', def: '1' },
  { key: 'ticket_dm_transcript', type: 'toggle', label: 'DM the transcript to the ticket owner', def: '1' }] }];

function typeForm(ctx, t) {
  const p = `t${t ? t.id : 'new'}`;
  const qs = JSON.parse(t?.questions || '[]').join('\n');
  const inner = (t ? `<input type="hidden" name="name" value="${esc(t.name)}">` : mini(ctx, p, 'name', 'Name', 'text', '', { max: 40, help: 'Shown on the panel button, for example Support.' })) +
    mini(ctx, p, 'emoji', 'Emoji', 'text', t?.emoji || '', { max: 40, help: 'Optional.' }) +
    mini(ctx, p, 'description', 'Description', 'text', t?.description || '', { max: 100, help: 'Shown under the name in dropdown panels.' }) +
    mini(ctx, p, 'category', 'Category', 'category', t?.category_id || '') +
    mini(ctx, p, 'support_roles', 'Staff roles', 'roles', t?.support_roles || '', { help: 'Up to 3. Hold Ctrl or Cmd to pick more than one.' }) +
    mini(ctx, p, 'welcome', 'Welcome message', 'textarea', t?.welcome || '', { max: 1000, help: 'You can use {user} {username} {type} {number}. Blank uses the default.' }) +
    mini(ctx, p, 'questions', 'Questions', 'textarea', qs, { rows: 4, max: 400, help: 'One per line, up to 5, 45 characters each. Asked in a popup before the ticket opens.' }) +
    mini(ctx, p, 'max_open', 'Open tickets per person', 'number', t?.max_open || 1, { min: 1, max: 10 }) +
    mini(ctx, p, 'naming', 'Channel name', 'text', t?.naming || '', { max: 60, placeholder: '{type}-{number}', help: 'You can use {type} {number} {username}.' });
  return form(ctx, 'type_save', inner, t ? 'Save type' : 'Create type');
}

const ticketsPage = {
  ...settingsPage('tickets', 'Tickets', TICKETS, (ctx) => {
    const g = ctx.guild.id;
    const types = db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? ORDER BY name').all(g);
    const list = types.length
      ? types.map((t) => `<details><summary>${esc(t.emoji || '🎫')} ${esc(t.name)}</summary>${typeForm(ctx, t)}${inlineForm(ctx, 'type_del', { id: t.id }, 'Delete this type', 'btn danger small')}</details>`).join('')
      : '<p class="empty">No ticket types yet. Create one below, then post a panel.</p>';
    const panel = types.length
      ? form(ctx, 'panel_post',
        mini(ctx, 'pn', 'channel', 'Post in', 'channel', '') +
        `<div class="row"><div class="what"><label>Ticket types</label></div><div class="ctl">${types.map((t) => `<label class="check"><input type="checkbox" name="types" value="${t.id}" checked> ${esc(t.name)}</label>`).join('')}</div></div>` +
        mini(ctx, 'pn', 'style', 'Style', 'select', 'buttons', { options: [['buttons', 'Buttons (up to 5 types)'], ['dropdown', 'Dropdown']] }) +
        mini(ctx, 'pn', 'title', 'Title', 'text', 'Support', { max: 100 }) +
        mini(ctx, 'pn', 'description', 'Text', 'textarea', 'Need help? Pick an option below to open a private ticket with our staff.', { max: 500 }), 'Post panel')
      : '<p class="empty">Create a ticket type first.</p>';
    return section('Ticket types', 'Each type has its own staff, category, questions and welcome message.', list) +
      section('New ticket type', '', typeForm(ctx, null)) + section('Post a panel', 'Members open tickets from a panel in the channel you choose.', panel);
  }),
};
ticketsPage.actions.type_save = (ctx, b) => {
  const g = ctx.guild.id;
  let name = String(b.name || '').trim().slice(0, 40);
  if (!name) fail('Give the ticket type a name.');
  const existing = db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? AND lower(name) = ?').get(g, name.toLowerCase());
  if (existing) name = existing.name;
  else if (count('SELECT COUNT(*) c FROM ticket_types WHERE guild_id = ?', g) >= LIMIT.types) fail(`Up to ${LIMIT.types} ticket types.`);
  const roles = arr(b.support_roles).filter((r) => ctx.roleIds.has(r)).slice(0, 3).join(',');
  const questions = JSON.stringify(String(b.questions || '').split('\n').map((q) => q.trim().slice(0, 45)).filter(Boolean).slice(0, 5));
  db.prepare(`INSERT INTO ticket_types (guild_id, name, emoji, description, category_id, support_roles, welcome, questions, max_open, naming) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, name) DO UPDATE SET emoji = excluded.emoji, description = excluded.description, category_id = excluded.category_id, support_roles = excluded.support_roles,
    welcome = excluded.welcome, questions = excluded.questions, max_open = excluded.max_open, naming = excluded.naming`)
    .run(g, name, String(b.emoji || '').trim() || null, String(b.description || '').trim() || null, ctx.categoryIds.has(b.category) ? b.category : null, roles,
      String(b.welcome || '').trim() || null, questions, clamp(parseInt(b.max_open, 10) || 1, 1, 10), String(b.naming || '').trim() || null);
  return `Ticket type "${name}" saved.`;
};
ticketsPage.actions.type_del = (ctx, b) => { db.prepare('DELETE FROM ticket_types WHERE guild_id = ? AND id = ?').run(ctx.guild.id, parseInt(b.id, 10)); return 'Ticket type deleted. Panels that used it will tell people it no longer exists.'; };
ticketsPage.actions.panel_post = async (ctx, b) => {
  if (!ctx.channelIds.has(b.channel)) fail('Choose a channel to post in.');
  const ids = arr(b.types).map((x) => parseInt(x, 10));
  const types = db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? ORDER BY name').all(ctx.guild.id).filter((t) => ids.includes(t.id));
  if (!types.length) fail('Pick at least one ticket type.');
  const style = b.style === 'dropdown' ? 'dropdown' : 'buttons';
  if (style === 'buttons' && types.length > 5) fail('Button panels hold up to 5 types. Use the dropdown style or pick fewer.');
  await ctx.guild.channels.cache.get(b.channel).send(tickets.panelPayload(types, style, String(b.title || '').slice(0, 100), String(b.description || '').slice(0, 500))).catch(() => fail(NO_PERMS));
  return 'Panel posted.';
};

// ================= live alerts =================
const live = {
  id: 'live', title: 'Live alerts',
  render(ctx) {
    const rows = db.prepare('SELECT * FROM live_alerts WHERE guild_id = ? ORDER BY platform, display').all(ctx.guild.id);
    const list = rows.length
      ? `<table class="list"><thead><tr><th>Streamer</th><th>Platform</th><th>Posts in</th><th>Pings</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.display || r.username)}${r.is_live ? ' <span class="good">live now</span>' : ''}</td><td>${esc(r.platform)}</td><td>${esc(ctx.chName(r.channel_id))}</td><td>${r.role_id ? esc(ctx.roleName(r.role_id)) : '-'}</td><td>${inlineForm(ctx, 'del', { id: r.id }, 'Remove')}</td></tr>`).join('')}</tbody></table>`
      : '<p class="empty">Nobody tracked yet.</p>';
    return `<h1>Live alerts</h1>${section('Tracked streamers', 'Twitch and Kick are checked every minute, YouTube every five.', list)}` +
      section('Add a streamer', 'The streamer is looked up before it is saved.', form(ctx, 'add',
        mini(ctx, 'lv', 'platform', 'Platform', 'select', 'twitch', { options: [['twitch', 'Twitch'], ['kick', 'Kick'], ['youtube', 'YouTube']] }) +
        mini(ctx, 'lv', 'username', 'Username', 'text', '', { help: 'Username, channel link, or a YouTube @handle.' }) +
        mini(ctx, 'lv', 'channel', 'Post in', 'channel', '') + mini(ctx, 'lv', 'role', 'Role to ping', 'role', '') +
        mini(ctx, 'lv', 'message', 'Custom text', 'textarea', '', { max: 500, help: 'Optional. You can use {name} {title} {game} {url} {platform}.' }), 'Add streamer'));
  },
  actions: {
    async add(ctx, b) {
      if (!ctx.channelIds.has(b.channel)) fail('Choose a channel to post in.');
      try {
        const display = await alerts.addAlert(ctx.guild.id, { platform: b.platform, username: b.username, channelId: b.channel, roleId: ctx.roleIds.has(b.role) ? b.role : null, message: String(b.message || '').slice(0, 500) });
        return `Now watching ${display}.`;
      } catch (e) { fail(e.message); }
    },
    del: (ctx, b) => { db.prepare('DELETE FROM live_alerts WHERE guild_id = ? AND id = ?').run(ctx.guild.id, parseInt(b.id, 10)); return 'Removed.'; },
  },
};

// ================= feeds =================
const feedsPage = {
  id: 'feeds', title: 'Social feeds',
  render(ctx) {
    const rows = db.prepare('SELECT * FROM feeds WHERE guild_id = ? ORDER BY platform, display').all(ctx.guild.id);
    const list = rows.length
      ? `<table class="list"><thead><tr><th>Source</th><th>Platform</th><th>Posts in</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.display || r.target)}</td><td>${esc(r.platform)}</td><td>${esc(ctx.chName(r.channel_id))}</td><td>${inlineForm(ctx, 'del', { id: r.id }, 'Remove')}</td></tr>`).join('')}</tbody></table>`
      : '<p class="empty">No feeds yet.</p>';
    return `<h1>Social feeds</h1>${section('Followed feeds', 'New posts and videos appear within about five minutes. Items that already exist are not posted.', list)}` +
      section('Follow something new', 'X, TikTok and Instagram go through RSSHub and may not work without extra setup.', form(ctx, 'add',
        mini(ctx, 'fd', 'platform', 'Platform', 'select', 'youtube', { options: feeds.platforms }) +
        mini(ctx, 'fd', 'target', 'Account or link', 'text', '', { max: 300, help: 'YouTube @handle, r/subreddit, Bluesky handle, @user@instance, owner/repo, a username, or an RSS link.' }) +
        mini(ctx, 'fd', 'channel', 'Post in', 'channel', '') + mini(ctx, 'fd', 'role', 'Role to ping', 'role', '') +
        mini(ctx, 'fd', 'message', 'Custom text', 'textarea', '', { max: 500, help: 'Optional. You can use {name} {title} {link} {author}.' }), 'Follow'));
  },
  actions: {
    async add(ctx, b) {
      if (!ctx.channelIds.has(b.channel)) fail('Choose a channel to post in.');
      try {
        const r = await feeds.addFeed(ctx.guild.id, { platform: b.platform, target: b.target, channelId: b.channel, roleId: ctx.roleIds.has(b.role) ? b.role : null, message: String(b.message || '').slice(0, 500) });
        return `Following ${r.display}.`;
      } catch (e) { fail(e.message); }
    },
    del(ctx, b) {
      const id = parseInt(b.id, 10);
      if (db.prepare('DELETE FROM feeds WHERE guild_id = ? AND id = ?').run(ctx.guild.id, id).changes) db.prepare('DELETE FROM feed_seen WHERE feed_id = ?').run(id);
      return 'Removed.';
    },
  },
};

// ================= applications =================
function appForm(ctx, f) {
  const p = `a${f ? f.name : 'new'}`.replace(/\W/g, '');
  const qs = JSON.parse(f?.questions || '[]').join('\n');
  return form(ctx, 'form_save',
    (f ? `<input type="hidden" name="name" value="${esc(f.name)}">` : mini(ctx, p, 'name', 'Name', 'text', '', { max: 30, help: 'For example staff. Letters, numbers and - only.' })) +
    mini(ctx, p, 'questions', 'Questions', 'textarea', qs, { rows: 4, max: 400, help: 'One per line, up to 5, 45 characters each.' }) +
    mini(ctx, p, 'review', 'Review channel', 'channel', f?.channel_id || '', { help: 'Where finished applications are posted for staff.' }) +
    mini(ctx, p, 'role', 'Role when accepted', 'role', f?.role_id || ''), f ? 'Save form' : 'Create form');
}
const applications = {
  id: 'applications', title: 'Applications',
  render(ctx) {
    const forms = db.prepare('SELECT * FROM app_forms WHERE guild_id = ? ORDER BY name').all(ctx.guild.id);
    const list = forms.length
      ? forms.map((f) => `<details><summary>${esc(f.name)}</summary>${appForm(ctx, f)}${inlineForm(ctx, 'form_del', { name: f.name }, 'Delete this form', 'btn danger small')}</details>`).join('')
      : '<p class="empty">No forms yet.</p>';
    const panel = forms.length
      ? form(ctx, 'panel_post', mini(ctx, 'ap', 'form', 'Form', 'select', forms[0].name, { options: forms.map((f) => [f.name, f.name]) }) + mini(ctx, 'ap', 'channel', 'Post in', 'channel', ''), 'Post Apply button')
      : '<p class="empty">Create a form first.</p>';
    return `<h1>Applications</h1>${section('Forms', 'Applicants fill in a popup. Staff accept or deny from the review channel.', list)}${section('New form', '', appForm(ctx, null))}${section('Post an Apply button', '', panel)}`;
  },
  actions: {
    form_save(ctx, b) {
      const g = ctx.guild.id; const name = String(b.name || '').trim().toLowerCase().replace(/[^\w-]/g, '').slice(0, 30);
      if (!name) fail('Give the form a name (letters, numbers and - only).');
      const questions = String(b.questions || '').split('\n').map((q) => q.trim().slice(0, 45)).filter(Boolean).slice(0, 5);
      if (!questions.length) fail('Add at least one question.');
      if (!ctx.channelIds.has(b.review)) fail('Choose a review channel.');
      if (!db.prepare('SELECT 1 FROM app_forms WHERE guild_id = ? AND name = ?').get(g, name) && count('SELECT COUNT(*) c FROM app_forms WHERE guild_id = ?', g) >= LIMIT.forms) fail(`Up to ${LIMIT.forms} forms.`);
      db.prepare('INSERT INTO app_forms VALUES (?, ?, ?, ?, ?) ON CONFLICT (guild_id, name) DO UPDATE SET questions = excluded.questions, channel_id = excluded.channel_id, role_id = excluded.role_id')
        .run(g, name, JSON.stringify(questions), b.review, ctx.roleIds.has(b.role) ? b.role : null);
      return `Form "${name}" saved.`;
    },
    form_del: (ctx, b) => { db.prepare('DELETE FROM app_forms WHERE guild_id = ? AND name = ?').run(ctx.guild.id, String(b.name)); return 'Deleted.'; },
    async panel_post(ctx, b) {
      const f = db.prepare('SELECT * FROM app_forms WHERE guild_id = ? AND name = ?').get(ctx.guild.id, String(b.form));
      if (!f) fail('Choose a form.');
      if (!ctx.channelIds.has(b.channel)) fail('Choose a channel to post in.');
      await ctx.guild.channels.cache.get(b.channel).send({
        embeds: [new EmbedBuilder().setTitle(`📝 ${f.name} application`).setDescription('Click the button to apply.')],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`app:open:${f.name}`).setLabel('Apply').setStyle(ButtonStyle.Primary))],
      }).catch(() => fail(NO_PERMS));
      return 'Button posted.';
    },
  },
};

const PAGES = {};
const ORDER = ['overview', 'general', 'moderation', 'levels', 'community', 'commands', 'tickets', 'live', 'feeds', 'applications'];
for (const p of [overview, settingsPage('general', 'General', GENERAL), moderation, levels, community, commands, ticketsPage, live, feedsPage, applications]) PAGES[p.id] = p;

module.exports = { PAGES, ORDER, UserError, buildCtx };
