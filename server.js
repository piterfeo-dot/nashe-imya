'use strict';
/* «Наш пиздюк» — сервер. Без внешних библиотек: нужен только Node.js 18+.
   Отдаёт страницу, проверяет вход через Telegram и хранит общее состояние пары в одном файле. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), vm = require('vm');

const PORT = +process.env.PORT || 8080;
const TOKEN = process.env.BOT_TOKEN || '';          // токен бота от BotFather. Только в переменной окружения.
const DEV = process.env.DEV_MODE === '1';           // вход без Telegram, только для проверки на своём компьютере
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!TOKEN && !DEV) { console.error('Не задан BOT_TOKEN'); process.exit(1); }

const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const Core = vm.runInNewContext(src.match(/\/\*SHARED-BEGIN\*\/([\s\S]*?)\/\*SHARED-END\*\//)[1] + '\n;Core');
/* Шрифты и библиотека Telegram отдаются с этого же сервера: страница не ждёт внешние адреса */
const FONTS = path.join(__dirname, 'fonts'), HAS_FONTS = fs.existsSync(path.join(FONTS, 'fonts.css'));
let TGJS = null; try { const t = fs.readFileSync(path.join(__dirname, 'tg.js')); if (t.length > 1000) TGJS = t; } catch (e) {}
const PAGE = '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">'
  + '<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>'
  + (TGJS ? '<script src="tg.js"></script>' : '') + '</head><body>'
  + (HAS_FONTS ? src.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, '<link rel="stylesheet" href="fonts/fonts.css">') : src) + '</body></html>';

/* Хранилище: у каждой пары своя комната = один файл data/rooms/КОД.json.
   Код комнаты (6 знаков) — приглашение для второго родителя. Гостевой код (G + 6 знаков) — для друзей и родных. */
const ROOMS = path.join(DATA, 'rooms'), USERS = path.join(DATA, 'users.json');
const MAX_ROOMS = +process.env.MAX_ROOMS || 10;   // сколько пар может завести комнату
const MAX_GUESTS = 30;                            // гостей на одну комнату
fs.mkdirSync(ROOMS, { recursive: true });
const code = () => Array.from(crypto.randomBytes(6), b => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
function write(file, obj) { fs.writeFileSync(file + '.tmp', JSON.stringify(obj)); fs.renameSync(file + '.tmp', file); }
const save = r => write(path.join(ROOMS, r.id + '.json'), r);
let users = {}; try { users = JSON.parse(fs.readFileSync(USERS, 'utf8')); } catch (e) {}
/* у человека может быть одна своя комната (home) и сколько угодно комнат, где он гость */
function who(uid) { let x = users[uid]; if (typeof x === 'string') x = users[uid] = { home: x, guest: [] }; return x || { home: null, guest: [] }; }
const cache = new Map(), gindex = new Map();
function prep(r) {
  Core.migrate(r.state); r.guestIds = r.guestIds || {}; r.gseq = r.gseq || 0;
  const fresh = !r.gcode; if (fresh) { do r.gcode = 'G' + code(); while (gindex.has(r.gcode)); }
  cache.set(r.id, r); gindex.set(r.gcode, r.id); if (fresh) save(r);
  return r;
}
for (const f of fs.readdirSync(ROOMS)) if (f.endsWith('.json')) { try { prep(JSON.parse(fs.readFileSync(path.join(ROOMS, f), 'utf8'))); } catch (e) { console.error('Не читается комната ' + f); } }
const room = id => cache.get(id) || null;

/* Кто пришёл. Telegram подписывает данные о пользователе токеном бота — подделать их без токена нельзя. */
function whoIs(req) {
  if (DEV && req.headers['x-dev-user']) return { id: 'dev' + String(req.headers['x-dev-user']).slice(0, 8) };
  if (!TOKEN) return null;
  try {
    const q = new URLSearchParams(String(req.headers['x-tg-init'] || '')), hash = q.get('hash') || '';
    q.delete('hash');
    const check = [...q.entries()].map(([k, v]) => k + '=' + v).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
    const calc = crypto.createHmac('sha256', secret).update(check).digest();
    const got = Buffer.from(hash, 'hex');
    if (got.length !== calc.length || !crypto.timingSafeEqual(got, calc)) return null;
    if (Date.now() / 1000 - (+q.get('auth_date') || 0) > 3 * 86400) return null;
    const u = JSON.parse(q.get('user'));
    return u && u.id ? { id: 'tg' + u.id } : null;
  } catch (e) { return null; }
}
let BOT = '';                      // адрес бота (без @) — для ссылки в приглашении
async function askBot() {
  if (BOT || !TOKEN) return;
  try { const j = await (await fetch('https://api.telegram.org/bot' + TOKEN + '/getMe')).json(); if (j.ok) BOT = j.result.username; } catch (e) {}
  if (!BOT) setTimeout(askBot, 60000).unref();
}
askBot();
const title = r => { const P = r.state.profile; return P.example ? 'Новая комната' : P.dad + ' и ' + P.mom; };
function ctxOf(uid) {
  const info = who(uid), list = [];
  if (info.home && room(info.home)) list.push({ id: info.home, role: 'parent', title: title(room(info.home)) });
  for (const id of info.guest) if (room(id)) list.push({ id, role: 'guest', title: title(room(id)) });
  return list;
}
/* В какой комнате человек сейчас: та, что открыта на его устройстве, иначе первая из его комнат */
function resolve(req, uid) {
  const ctx = ctxOf(uid), c = ctx.find(x => x.id === String(req.headers['x-room'] || '')) || ctx[0];
  if (!c) return null;
  const r = room(c.id);
  if (c.role === 'parent') { const p = r.members.findIndex(m => m && m.id === uid); return p < 0 ? null : { r, p, ctx }; }
  return r.guestIds[uid] ? { r, gid: r.guestIds[uid], ctx } : null;
}
function snap(c) {
  const r = c.r, base = { joined: true, room: r.id, v: r.v, bot: BOT, ctx: c.ctx };
  return c.gid ? Object.assign(base, { guest: true, gview: Core.gview(r.state, c.gid) })
    : Object.assign(base, { p: c.p, state: r.state, invite: r.members.includes(null) ? r.id : null, gcode: r.gcode });
}
function body(req) {
  return new Promise((res, rej) => {
    let s = ''; req.on('data', c => { s += c; if (s.length > 10000) { rej(new Error('big')); req.destroy(); } });
    req.on('end', () => { try { res(JSON.parse(s || '{}')); } catch (e) { rej(e); } });
  });
}
function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x'), route = req.method + ' ' + url.pathname;
    if (route === 'GET /') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(PAGE); }
    if (route === 'GET /api/ping') return json(res, 200, { app: 'nashe-imya' });
    if (route === 'GET /tg.js' && TGJS) { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }); return res.end(TGJS); }
    const fm = req.method === 'GET' && HAS_FONTS && url.pathname.match(/^\/fonts\/([a-z-]+\.(woff2|css))$/);
    if (fm && fs.existsSync(path.join(FONTS, fm[1]))) {
      res.writeHead(200, { 'Content-Type': fm[2] === 'css' ? 'text/css; charset=utf-8' : 'font/woff2', 'Cache-Control': 'public, max-age=2592000' });
      return res.end(fs.readFileSync(path.join(FONTS, fm[1])));
    }
    if (!url.pathname.startsWith('/api/')) { res.writeHead(404); return res.end('Not found'); }

    const u = whoIs(req);
    if (!u) return json(res, 401, { err: 'Нет входа через Telegram.' });
    const uid = u.id, c = resolve(req, uid);

    if (route === 'GET /api/state') {
      if (!c) return json(res, 200, { joined: false, ctx: [] });
      return json(res, 200, +url.searchParams.get('v') === c.r.v && url.searchParams.get('r') === c.r.id ? { same: true } : snap(c));
    }
    /* Что за код пришёл по ссылке: чья комната, гостевой он или для второго родителя, состоит ли в ней человек */
    if (route === 'GET /api/peek') {
      const k = String(url.searchParams.get('code') || '').trim().toUpperCase();
      const g = room(gindex.get(k)), t = g || room(k);
      if (!t) return json(res, 200, { found: false });
      const seat = t.members.findIndex(m => m && m.id === uid);
      return json(res, 200, { found: true, kind: g ? 'guest' : 'parent', room: t.id, title: title(t), member: seat >= 0 || !!t.guestIds[uid], taken: t.members.map(Boolean) });
    }
    if (route === 'POST /api/join') {
      const b = await body(req), k = String(b.code || '').trim().toUpperCase(), info = who(uid), no = err => json(res, 200, { joined: false, err });
      const done = t => json(res, 200, snap(resolve({ headers: { 'x-room': t.id } }, uid)));
      if (b.role === 'guest') {
        const t = room(gindex.get(k));
        if (!t) return no(room(k) ? 'Это код для второго родителя. Гостевой код начинается с буквы G.' : 'Гостевой код не найден. Проверьте код.');
        if (t.members.some(m => m && m.id === uid)) return no('Это ваша собственная комната: вы в ней родитель.');
        if (t.guestIds[uid]) return done(t);
        const name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 30);
        if (!name) return no('Напишите, как вас подписать: так родители поймут, чей это голос.');
        if (Object.keys(t.guestIds).length >= MAX_GUESTS) return no('В этой комнате уже слишком много гостей.');
        const gid = 'g' + (++t.gseq);
        t.guestIds[uid] = gid; t.state.guests[gid] = { name }; t.v++; save(t);
        info.guest.push(t.id); users[uid] = info; write(USERS, users);
        return done(t);
      }
      const role = b.role === 1 ? 1 : 0;
      if (info.home && room(info.home)) return no('У вас уже есть своя комната. В другие можно войти только гостем.');
      let t;
      if (k) {
        if (gindex.has(k)) return no('Это гостевой код. Напишите своё имя и нажмите «Я гость».');
        t = room(k);
        if (!t) return no('Комната с таким кодом не найдена. Проверьте код.');
        if (!t.members.includes(null)) return no('В этой комнате уже двое родителей.');
        if (t.members[role]) return no('Эта роль в комнате уже занята. Выберите другую.');
        if (t.guestIds[uid]) return no('Вы уже гость в этой комнате.');
      } else {
        if (cache.size >= MAX_ROOMS) return no('Свободных комнат пока нет. Если вас пригласили, введите код приглашения.');
        let id = code(); while (room(id)) id = code();
        t = prep({ id, v: 1, members: [null, null], state: Core.fresh(), at: Date.now() });
      }
      t.members[role] = { id: uid, at: Date.now() }; t.v++; save(t);
      info.home = t.id; users[uid] = info; write(USERS, users);
      return done(t);
    }
    if (route === 'POST /api/act') {
      if (!c) return json(res, 200, { joined: false, ctx: [] });
      const b = await body(req), a = b && b.a;
      if (!a || typeof a !== 'object') return json(res, 400, { err: 'Пустой запрос.' });
      const out = c.gid ? Core.gapply(c.r.state, c.gid, a) : Core.apply(c.r.state, c.p, a);
      if (out.err) return json(res, 200, Object.assign(snap(c), { err: out.err }));
      c.r.v++; save(c.r);
      return json(res, 200, Object.assign(snap(c), { ok: 1, ev: out.ev }));
    }
    json(res, 404, { err: 'Нет такого адреса.' });
  } catch (e) { json(res, 400, { err: 'Ошибка запроса.' }); }
}).listen(PORT, () => console.log('Наш пиздюк: порт ' + PORT + (DEV ? ' (режим проверки)' : '')));
