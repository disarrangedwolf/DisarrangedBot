const { XMLParser } = require('fast-xml-parser');
const { getText } = require('./net');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const text = (v) => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v));
const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const firstImg = (html) => /<img[^>]+src=["']([^"']+)/i.exec(html)?.[1] || null;

// Returns { title, entries: [{ id, title, link, summary, image, published, author }] } (newest first as given by the feed)
function parseFeed(xml) {
  const doc = parser.parse(xml);
  if (doc.rss) {
    const ch = doc.rss.channel || {};
    return {
      title: strip(text(ch.title)),
      entries: arr(ch.item).map((it) => {
        const desc = text(it.description) || text(it['content:encoded']);
        const enc = it.enclosure?.['@_type']?.startsWith('image') ? it.enclosure['@_url'] : null;
        return {
          id: text(it.guid) || text(it.link),
          title: strip(text(it.title)),
          link: text(it.link) || (text(it.guid).startsWith('http') ? text(it.guid) : ''),
          summary: strip(desc).slice(0, 400),
          image: enc || it['media:thumbnail']?.['@_url'] || arr(it['media:content'])[0]?.['@_url'] || firstImg(desc),
          published: Date.parse(text(it.pubDate)) || 0,
          author: strip(text(it['dc:creator'] ?? it.author)),
        };
      }),
    };
  }
  if (doc.feed) {
    const f = doc.feed;
    return {
      title: strip(text(f.title)),
      entries: arr(f.entry).map((e) => {
        const links = arr(e.link);
        const alt = links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate') || links[0];
        const mg = e['media:group'] || {};
        const body = text(e.summary) || text(e.content) || text(mg['media:description']);
        return {
          id: text(e['yt:videoId']) || text(e.id) || alt?.['@_href'],
          title: strip(text(e.title)),
          link: alt?.['@_href'] || '',
          summary: strip(body).slice(0, 400),
          image: mg['media:thumbnail']?.['@_url'] || e['media:thumbnail']?.['@_url'] || firstImg(text(e.content)),
          published: Date.parse(text(e.published) || text(e.updated)) || 0,
          author: strip(text(e.author?.name)),
        };
      }),
    };
  }
  throw new Error('That URL is not an RSS/Atom feed.');
}

async function fetchFeed(url) {
  return parseFeed(await getText(url, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } }));
}

module.exports = { fetchFeed, parseFeed };
