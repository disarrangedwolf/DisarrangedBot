// Safe online backup of bot.db (works while the bot is running). Keeps the last 14 days.
// Run:  npm run backup     (or schedule it, see deploy/DEPLOY-WINDOWS.md)
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const Database = require('better-sqlite3');

const src = process.env.DB_PATH || path.join(__dirname, 'bot.db');
const dir = path.join(__dirname, 'backups');
fs.mkdirSync(dir, { recursive: true });
const name = `bot-${new Date().toISOString().slice(0, 10)}.db`;

(async () => {
  const db = new Database(src, { readonly: true, fileMustExist: true });
  await db.backup(path.join(dir, name));
  db.close();
  const cutoff = Date.now() - 14 * 864e5;
  for (const f of fs.readdirSync(dir)) {
    if (!/^bot-\d{4}-\d{2}-\d{2}\.db$/.test(f)) continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
  }
  console.log(`Backup saved: backups/${name}`);
})().catch((e) => { console.error('Backup failed:', e.message); process.exit(1); });
