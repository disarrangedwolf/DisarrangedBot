require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, Collection, REST, Routes, Events, MessageFlags } = require('discord.js');
const { inviteUrl } = require('./utils');
const { getSetting, setSetting } = require('./db');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,        // privileged: enable in dev portal
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,      // privileged: enable in dev portal
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.commands = new Collection();

// Production hardening: a failed promise should be logged, not crash the bot; stop cleanly when the service is stopped
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { console.log(`${sig} received, shutting down`); try { await client.destroy(); } catch { /* already closed */ } process.exit(0); });
}
const buttons = [];
const inits = [];

// Every file in /modules can export: commands[], events[], buttons[], init(client)
for (const file of fs.readdirSync(path.join(__dirname, 'modules')).filter((f) => f.endsWith('.js'))) {
  const mod = require(`./modules/${file}`);
  for (const c of mod.commands || []) client.commands.set(c.data.name, c);
  for (const e of mod.events || []) {
    client.on(e.name, (...args) =>
      Promise.resolve(e.execute(...args)).catch((err) => console.error(`[${file}]`, err)));
  }
  for (const b of mod.buttons || []) buttons.push(b);
  if (mod.init) inits.push(mod.init);
}

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isChatInputCommand()) {
      if (!i.inGuild()) return i.reply({ content: 'Use me inside a server.', flags: MessageFlags.Ephemeral });
      const c = client.commands.get(i.commandName);
      if (c) await c.execute(i);
    } else if (i.isButton() || i.isModalSubmit() || i.isStringSelectMenu()) {
      const b = buttons.find((x) => i.customId.startsWith(x.prefix));
      if (b) await b.execute(i);
    }
  } catch (err) {
    console.error(err);
    const msg = { content: 'Something went wrong running that.', flags: MessageFlags.Ephemeral };
    if (i.replied || i.deferred) i.followUp(msg).catch(() => {});
    else i.reply(msg).catch(() => {});
  }
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  const body = [...client.commands.values()].map((x) => x.data.toJSON());
  if (process.env.GUILD_ID) {
    // testing mode: instant updates, but ONLY in that one server
    await rest.put(Routes.applicationGuildCommands(c.user.id, process.env.GUILD_ID), { body });
    console.log(`Registered ${body.length} commands in guild ${process.env.GUILD_ID} only. Remove GUILD_ID to work in every server.`);
  } else {
    await rest.put(Routes.applicationCommands(c.user.id), { body });
    console.log(`Registered ${body.length} global commands (all servers)`);
    // one-time cleanup of per-server copies left over from testing mode, so commands don't show twice
    if (!getSetting('_global', 'guild_cmds_cleared')) {
      for (const g of c.guilds.cache.values()) await rest.put(Routes.applicationGuildCommands(c.user.id, g.id), { body: [] }).catch(() => {});
      setSetting('_global', 'guild_cmds_cleared', '1');
    }
  }
  console.log(`In ${c.guilds.cache.size} server(s). Invite link: ${inviteUrl(c)}`);
  for (const init of inits) init(client);
  try { require('./web/server').start(client); } catch (e) { console.error('[web] failed to start:', e); }
});

client.login(process.env.DISCORD_TOKEN);
