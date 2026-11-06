const net = require('net');

const UA = 'AllInOneDiscordBot/1.0 (+https://discord.com)';

async function get(url, { headers = {}, timeout = 15000, ...opts } = {}) {
  return fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(timeout), ...opts });
}
async function getJson(url, o) {
  const r = await get(url, o);
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).hostname}`);
  return r.json();
}
async function getText(url, o) {
  const r = await get(url, o);
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).hostname}`);
  return r.text();
}

// Basic guard so staff can't point the bot at localhost / private networks
function isSafeUrl(u) {
  let url;
  try { url = new URL(u); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  const h = url.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (net.isIP(h)) {
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === '::1' || /^(fc|fd|fe80)/i.test(h)) return false;
  }
  return true;
}

// Accepts a channel URL, @handle or UC... channel ID -> { id, name }
async function resolveYouTube(input) {
  input = input.trim();
  const direct = input.match(/UC[\w-]{22}/);
  if (direct) return { id: direct[0], name: null };
  const handle = input.match(/@[\w.-]+/)?.[0];
  if (!handle) throw new Error('Use a YouTube channel URL, @handle or channel ID.');
  const key = process.env.YOUTUBE_API_KEY;
  if (key) {
    const j = await getJson(`https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=${encodeURIComponent(handle)}&key=${key}`).catch(() => null);
    const c = j?.items?.[0];
    if (c) return { id: c.id, name: c.snippet.title };
  }
  const html = await getText(`https://www.youtube.com/${handle}`, { headers: { Cookie: 'CONSENT=YES+1; SOCS=CAI', 'Accept-Language': 'en' } });
  const id = html.match(/channel_id=(UC[\w-]{22})/)?.[1] || html.match(/"channelId":"(UC[\w-]{22})"/)?.[1];
  if (!id) throw new Error("Couldn't find that YouTube channel.");
  return { id, name: html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || handle };
}

module.exports = { get, getJson, getText, isSafeUrl, resolveYouTube };
