const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FONTS = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,600..800&display=swap';

const CSS = `
:root{--paper:#F2F4F7;--panel:#fff;--ink:#101828;--navy:#14213D;--navy2:#1B2C52;--muted:#566176;--line:#D6DCE5;--amber:#FFB400;--amber-ink:#1B1400;--bad:#B42318;--good:#067647}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:400 1rem/1.55 "Atkinson Hyperlegible",system-ui,-apple-system,"Segoe UI",sans-serif}
h1,h2,h3,.brand{font-family:"Bricolage Grotesque","Atkinson Hyperlegible",system-ui,sans-serif;letter-spacing:-.02em;line-height:1.08;margin:0}
a{color:inherit;text-underline-offset:3px}
:focus-visible{outline:3px solid var(--amber);outline-offset:2px}
.top{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px clamp(16px,3vw,32px);background:var(--navy);color:#fff}
.brand{display:flex;align-items:center;gap:10px;font-size:1.2rem;font-weight:800;text-decoration:none}
.mark{width:13px;height:13px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 4px rgba(255,180,0,.25)}
.who{display:flex;align-items:center;gap:12px;font-size:.95rem}
.who img{width:28px;height:28px;border-radius:50%}
.who form{margin:0}
.btn{display:inline-block;border:2px solid var(--amber);background:var(--amber);color:var(--amber-ink);font:700 1rem "Atkinson Hyperlegible",system-ui,sans-serif;padding:9px 18px;border-radius:6px;text-decoration:none;cursor:pointer}
.btn:hover{background:#ffc43d;border-color:#ffc43d}
.btn.ghost{background:transparent;color:inherit;border-color:currentColor}
.btn.ghost:hover{background:rgba(127,127,127,.14)}
.btn.danger{background:transparent;color:var(--bad);border-color:var(--bad)}
.btn.danger:hover{background:rgba(180,35,24,.08)}
.btn.small{padding:4px 12px;font-size:.9rem}
.linkbtn{background:none;border:0;color:inherit;font:inherit;text-decoration:underline;cursor:pointer;padding:0}
.wrap{max-width:1040px;margin:0 auto;padding:0 clamp(16px,3vw,32px)}
.hero{background:var(--navy);color:#fff;padding:clamp(40px,8vw,96px) 0 clamp(40px,7vw,80px)}
.hero h1{font-size:clamp(2.6rem,7vw,5.2rem);font-weight:800;max-width:11ch}
.lead{font-size:1.2rem;max-width:52ch;color:#C9D3E6;margin:22px 0 28px}
.roster{list-style:none;margin:0 0 36px;padding:0;display:flex;flex-wrap:wrap;gap:8px 10px}
.roster li{padding:5px 12px;border:1px solid #3B4D78;border-radius:999px;color:#8FA0C4}
.roster s{text-decoration-thickness:2px;text-decoration-color:var(--amber)}
.roster li.live{background:var(--amber);border-color:var(--amber);color:var(--amber-ink);font-weight:700}
.cta{display:flex;flex-wrap:wrap;gap:12px}
.facts{margin:0;padding:48px 0 64px;display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr);gap:0 32px}
.facts dt,.facts dd{padding:16px 0;border-top:1px solid var(--line);margin:0}
.facts dt{font:700 1.1rem "Bricolage Grotesque",system-ui,sans-serif}
.facts dd{color:var(--muted);max-width:60ch}
.page{padding:36px 0 64px}
.page h1{font-size:2.2rem;margin-bottom:6px}
.sub{color:var(--muted);margin:0 0 28px;max-width:60ch}
.servers{list-style:none;margin:0 0 32px;padding:0;border-top:1px solid var(--line)}
.servers li{display:flex;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid var(--line)}
.servers .name{flex:1;font-weight:700;overflow-wrap:anywhere}
.icon{width:44px;height:44px;border-radius:12px;background:var(--navy);color:#fff;display:grid;place-items:center;font:800 1rem "Bricolage Grotesque",system-ui,sans-serif;overflow:hidden;flex:none}
.icon img{width:100%;height:100%}
.page h2{font-size:1.3rem;margin:8px 0 12px}
.shell{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:calc(100vh - 56px)}
.side{background:var(--navy2);color:#fff;padding:20px 0}
.side h2{font-size:1rem;padding:0 20px 14px;display:flex;align-items:center;gap:10px;overflow-wrap:anywhere}
.side .icon{width:32px;height:32px;border-radius:8px;font-size:.85rem;background:var(--navy)}
.side nav a{display:block;padding:9px 20px;text-decoration:none;color:#C9D3E6;border-left:4px solid transparent}
.side nav a:hover{background:rgba(255,255,255,.06)}
.side nav a[aria-current=page]{color:#fff;border-left-color:var(--amber);background:rgba(255,255,255,.08);font-weight:700}
.side .all{margin-top:18px;border-top:1px solid rgba(255,255,255,.12);padding-top:12px}
.main{padding:32px clamp(16px,4vw,48px) 72px;max-width:920px;width:100%}
.main h1{font-size:2rem;margin-bottom:22px}
.block{padding:26px 0;border-top:1px solid var(--line)}
.block>h2{font-size:1.25rem;margin-bottom:4px}
.intro{color:var(--muted);margin:0 0 12px;max-width:62ch}
.row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:8px 28px;padding:12px 0;align-items:start}
.what label{font-weight:700}
.what p{margin:2px 0 0;color:var(--muted);font-size:.92rem;max-width:46ch}
select,input[type=text],input[type=number],textarea{width:100%;font:inherit;color:inherit;background:var(--panel);border:1.5px solid var(--line);border-radius:6px;padding:8px 10px}
select[multiple]{padding:4px}
textarea{resize:vertical}
.bar{padding:10px 0 4px}
.lamp{display:inline-flex;align-items:center;gap:10px;cursor:pointer}
.lamp input{position:absolute;opacity:0;width:1px;height:1px}
.track{width:52px;height:28px;border-radius:999px;background:#C5CCD8;position:relative;transition:background .15s}
.knob{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:transform .15s}
.lamp input:checked + .track{background:var(--amber)}
.lamp input:checked + .track .knob{transform:translateX(24px)}
.lamp input:focus-visible + .track{outline:3px solid var(--navy);outline-offset:2px}
.lamp::after{content:"Off";font-size:.9rem;color:var(--muted);min-width:2.2ch}
.lamp:has(input:checked)::after{content:"On";color:var(--ink);font-weight:700}
.note{padding:10px 14px;margin:0 0 20px;border-left:5px solid var(--line);background:var(--panel)}
.note.ok{border-left-color:var(--good)}
.note.err{border-left-color:var(--bad)}
table.list{width:100%;border-collapse:collapse;margin:4px 0 8px}
.list th,.list td{text-align:left;padding:9px 12px 9px 0;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
.list th{font-weight:700;color:var(--muted);font-size:.9rem}
form.inline{display:inline;margin:0}
details{border-top:1px solid var(--line);padding:10px 0}
summary{cursor:pointer;font-weight:700;padding:4px 0}
.check{display:inline-flex;align-items:center;gap:6px;margin:0 14px 6px 0}
.good{color:var(--good);font-weight:700}
.bad{color:var(--bad);font-weight:700}
.empty{color:var(--muted);margin:6px 0 12px}
@media(max-width:800px){.shell{grid-template-columns:1fr}.side{padding:8px 0}.side nav{display:flex;overflow-x:auto}.side nav a{white-space:nowrap;border-left:0;border-bottom:4px solid transparent}.side nav a[aria-current=page]{border-bottom-color:var(--amber)}.side h2,.side .all{display:none}.row{grid-template-columns:1fr}.facts{grid-template-columns:1fr}.facts dt{border-bottom:0;padding-bottom:0}.facts dd{border-top:0;padding-top:0}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
`;

function layout({ title, body, user, csrf, botName }) {
  const who = user
    ? `<div class="who">${user.avatar ? `<img src="https://cdn.discordapp.com/avatars/${esc(user.id)}/${esc(user.avatar)}.png?size=64" alt="">` : ''}<span>${esc(user.username)}</span>` +
      `<form method="post" action="/logout"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="linkbtn" type="submit">Log out</button></form></div>`
    : '<a class="btn small" href="/login">Log in</a>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(title)}</title><link rel="stylesheet" href="${FONTS}"><style>${CSS}</style></head><body>` +
    `<header class="top"><a class="brand" href="/"><span class="mark"></span>${esc(botName)}</a>${who}</header>${body}</body></html>`;
}

const isSel = (sel, v) => (Array.isArray(sel) ? sel.includes(String(v)) : String(sel) === String(v));
const opts = (items, sel, empty) => (empty ? `<option value="">${esc(empty)}</option>` : '') +
  items.map(([v, n]) => `<option value="${esc(v)}"${isSel(sel, v) ? ' selected' : ''}>${esc(n)}</option>`).join('');

// One control per field type. f = { key, type, id?, options?, min?, max?, rows?, placeholder? }
function control(f, value, ctx) {
  const n = esc(f.key); const id = esc(f.id || `f-${f.key}`);
  switch (f.type) {
    case 'toggle': return `<label class="lamp"><input type="checkbox" id="${id}" name="${n}"${value === '1' ? ' checked' : ''}><span class="track"><span class="knob"></span></span></label>`;
    case 'channel': return `<select id="${id}" name="${n}">${opts(ctx.channels.map(([i, nm]) => [i, `#${nm}`]), value, 'Not set')}</select>`;
    case 'category': return `<select id="${id}" name="${n}">${opts(ctx.categories, value, 'Not set')}</select>`;
    case 'role': return `<select id="${id}" name="${n}">${opts(ctx.roles.map(([i, nm]) => [i, `@${nm}`]), value, 'Not set')}</select>`;
    case 'roles': return `<select id="${id}" name="${n}" multiple size="4">${opts(ctx.roles.map(([i, nm]) => [i, `@${nm}`]), String(value || '').split(',').filter(Boolean))}</select>`;
    case 'select': return `<select id="${id}" name="${n}">${opts(f.options, value)}</select>`;
    case 'number': return `<input type="number" id="${id}" name="${n}" min="${f.min ?? 0}" max="${f.max ?? 1000000}" value="${esc(value)}">`;
    case 'textarea': return `<textarea id="${id}" name="${n}" rows="${f.rows || 3}" maxlength="${f.max || 1900}">${esc(value)}</textarea>`;
    default: return `<input type="text" id="${id}" name="${n}" maxlength="${f.max || 200}" value="${esc(value)}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}${f.readonly ? ' readonly' : ''}>`;
  }
}

const row = (f, value, ctx) => `<div class="row"><div class="what"><label for="${esc(f.id || `f-${f.key}`)}">${esc(f.label)}</label>${f.help ? `<p>${esc(f.help)}</p>` : ''}</div><div class="ctl">${control(f, value, ctx)}</div></div>`;
const section = (title, intro, inner) => `<section class="block"><h2>${esc(title)}</h2>${intro ? `<p class="intro">${esc(intro)}</p>` : ''}${inner}</section>`;

function form(ctx, action, inner, label = 'Save changes') {
  return `<form method="post"><input type="hidden" name="_csrf" value="${esc(ctx.csrf)}"><input type="hidden" name="action" value="${esc(action)}">${inner}<div class="bar"><button class="btn" type="submit">${esc(label)}</button></div></form>`;
}
function inlineForm(ctx, action, fields, label, cls = 'btn ghost small') {
  const hidden = Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return `<form class="inline" method="post"><input type="hidden" name="_csrf" value="${esc(ctx.csrf)}"><input type="hidden" name="action" value="${esc(action)}">${hidden}<button class="${cls}" type="submit">${esc(label)}</button></form>`;
}

module.exports = { esc, layout, control, row, section, form, inlineForm };
