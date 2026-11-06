const path = require('path');
const Database = require('better-sqlite3');
// Always next to the code, so starting the bot from another folder (a service, Task Scheduler) can't create a second empty database
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'bot.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (guild_id TEXT, key TEXT, value TEXT, PRIMARY KEY (guild_id, key));
CREATE TABLE IF NOT EXISTS warnings (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, user_id TEXT, mod_id TEXT, reason TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS xp (guild_id TEXT, user_id TEXT, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 0, PRIMARY KEY (guild_id, user_id));
CREATE TABLE IF NOT EXISTS level_roles (guild_id TEXT, level INTEGER, role_id TEXT, PRIMARY KEY (guild_id, level));
CREATE TABLE IF NOT EXISTS economy (guild_id TEXT, user_id TEXT, balance INTEGER DEFAULT 0, last_daily INTEGER DEFAULT 0, last_work INTEGER DEFAULT 0, PRIMARY KEY (guild_id, user_id));
CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, channel_id TEXT, message TEXT, due INTEGER);
CREATE TABLE IF NOT EXISTS giveaways (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, channel_id TEXT, message_id TEXT, prize TEXT, winners INTEGER, ends INTEGER, ended INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS tags (guild_id TEXT, name TEXT, content TEXT, PRIMARY KEY (guild_id, name));
CREATE TABLE IF NOT EXISTS starred (message_id TEXT PRIMARY KEY, star_message_id TEXT);
`);

// Settings are read on almost every message across every server, so keep them in memory
const cache = new Map();
const getSetting = (g, k, d = null) => {
  const ck = `${g}:${k}`;
  if (!cache.has(ck)) {
    const r = db.prepare('SELECT value FROM settings WHERE guild_id = ? AND key = ?').get(g, k);
    cache.set(ck, r ? r.value : null);
  }
  const v = cache.get(ck);
  return v === null ? d : v;
};
const setSetting = (g, k, v) => {
  db.prepare('INSERT INTO settings VALUES (?, ?, ?) ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value').run(g, k, String(v));
  cache.set(`${g}:${k}`, String(v));
};
const clearGuildSettings = (g) => {
  db.prepare('DELETE FROM settings WHERE guild_id = ?').run(g);
  for (const k of cache.keys()) if (k.startsWith(`${g}:`)) cache.delete(k);
};

module.exports = { db, getSetting, setSetting, clearGuildSettings };
