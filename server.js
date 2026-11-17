'use strict';
/* «Наше имя» — сервер. Без внешних библиотек: нужен только Node.js 18+.
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

/* Хранилище: у каждой пары своя комната = один файл data/rooms/КОД.json. Код комнаты — он же код приглашения. */
const ROOMS = path.join(DATA, 'rooms'), USERS = path.join(DATA, 'users.json');
const MAX_ROOMS = +process.env.MAX_ROOMS || 10;   // сколько пар может завести комнату
fs.mkdirSync(ROOMS, { recursive: true });
const code = () => Array.from(crypto.randomBytes(6), b => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
function write(file, obj) { fs.writeFileSync(file + '.tmp', JSON.stringify(obj)); fs.renameSync(file + '.tmp', file); }
let users = {}; try { users = JSON.parse(fs.readFileSync(USERS, 'utf8')); } catch (e) {}
const cache = new Map();
function room(id) {
  if (!/^[A-Z0-9]{6}$/.test(id || '')) return null;
  if (cache.has(id)) return cache.get(id);
  try { const r = JSON.parse(fs.readFileSync(path.join(ROOMS, id + '.json'), 'utf8')); Core.migrate(r.state); cache.set(id, r); return r; } catch (e) { return null; }
}
const save = r => write(path.join(ROOMS, r.id + '.json'), r);

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
function snap(r, p) {
  return { joined: true, p, v: r.v, state: r.state, invite: r.members.includes(null) ? r.id : null, bot: BOT };
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
    const r = room(users[u.id]), p = r ? r.members.findIndex(m => m && m.id === u.id) : -1;

    if (route === 'GET /api/state') {
      if (p < 0) return json(res, 200, { joined: false });
      return json(res, 200, +url.searchParams.get('v') === r.v ? { same: true } : snap(r, p));
    }
    if (route === 'POST /api/join') {
      if (p >= 0) return json(res, 200, snap(r, p));
      const b = await body(req), role = b.role === 1 ? 1 : 0, c = String(b.code || '').trim().toUpperCase();
      let t;
      if (c) {
        t = room(c);
        if (!t) return json(res, 200, { joined: false, err: 'Комната с таким кодом не найдена. Проверьте код.' });
        if (!t.members.includes(null)) return json(res, 200, { joined: false, err: 'В этой комнате уже двое.' });
        if (t.members[role]) return json(res, 200, { joined: false, err: 'Эта роль в комнате уже занята. Выберите другую.' });
      } else {
        if (fs.readdirSync(ROOMS).filter(f => f.endsWith('.json')).length >= MAX_ROOMS) return json(res, 200, { joined: false, err: 'Свободных комнат пока нет. Если вас пригласили, введите код приглашения.' });
        let id = code(); while (room(id)) id = code();
        t = { id, v: 1, members: [null, null], state: Core.fresh(), at: Date.now() }; cache.set(id, t);
      }
      t.members[role] = { id: u.id, at: Date.now() }; t.v++; save(t);
      users[u.id] = t.id; write(USERS, users);
      return json(res, 200, snap(t, role));
    }
    if (route === 'POST /api/act') {
      if (p < 0) return json(res, 200, { joined: false });
      const b = await body(req), a = b && b.a;
      if (!a || typeof a !== 'object') return json(res, 400, { err: 'Пустой запрос.' });
      const out = Core.apply(r.state, p, a);
      if (out.err) return json(res, 200, Object.assign(snap(r, p), { err: out.err }));
      r.v++; save(r);
      return json(res, 200, Object.assign(snap(r, p), { ok: 1, ev: out.ev }));
    }
    json(res, 404, { err: 'Нет такого адреса.' });
  } catch (e) { json(res, 400, { err: 'Ошибка запроса.' }); }
}).listen(PORT, () => console.log('Наше имя: порт ' + PORT + (DEV ? ' (режим проверки)' : '')));
