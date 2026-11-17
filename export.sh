#!/usr/bin/env bash
# Выгрузка всех данных (комнаты, свайпы, мэтчи): бот присылает файлы вам в Telegram.
# Шаг 1: напишите боту любое сообщение.  Шаг 2: bash export.sh  Шаг 3: bash export.sh НОМЕР (номер подскажет шаг 2)
set -euo pipefail
cd "$(dirname "$0")"
if [ "$(id -u)" != 0 ]; then exec sudo bash "$0" "$@"; fi
docker compose exec -T -e EXPORT_TO="${1:-}" app node - <<'JS'
const fs = require('fs'), path = require('path');
const D = process.env.DATA_DIR || '/data', API = 'https://api.telegram.org/bot' + process.env.BOT_TOKEN, to = process.env.EXPORT_TO;
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
(async () => {
  if (!to) {
    const j = await (await fetch(API + '/getUpdates?limit=100')).json();
    if (!j.ok) throw new Error(j.description);
    const ms = j.result.map(u => u.message).filter(m => m && m.chat && m.chat.type === 'private');
    if (!ms.length) { console.log('Бот не видит новых сообщений. Откройте чат с ботом в Telegram, отправьте ему любое слово и запустите команду ещё раз.'); return; }
    const m = ms[ms.length - 1], f = m.from || {};
    console.log('Последнее сообщение боту прислал: ' + [f.first_name, f.last_name, f.username ? '(@' + f.username + ')' : ''].filter(Boolean).join(' '));
    console.log('Если это вы, запустите:');
    console.log('bash export.sh ' + m.chat.id);
    return;
  }
  const users = read(path.join(D, 'users.json'), {}), rooms = {};
  let dir = []; try { dir = fs.readdirSync(path.join(D, 'rooms')); } catch (e) {}
  for (const f of dir) if (f.endsWith('.json')) { const r = read(path.join(D, 'rooms', f), null); if (r) rooms[r.id] = r; }
  const ids = Object.keys(rooms);
  if (!ids.length) { console.log('Данных нет: ни одной комнаты.'); return; }

  let txt = 'Наш пиздюк — выгрузка от ' + new Date().toISOString().slice(0, 10) + '\n';
  for (const id of ids) {
    const S = rooms[id].state, P = S.profile;
    txt += `\n=== Комната ${id}: ${P.surname}, папа ${P.dad}, мама ${P.mom} ===\n`;
    for (const [g, title] of [['boy', 'МАЛЬЧИК'], ['girl', 'ДЕВОЧКА']]) {
      const E = S.d[g], v = E.votes, pick = (p, x) => Object.keys(v[p]).filter(n => v[p][n] === x);
      if (!Object.keys(v[0]).length && !Object.keys(v[1]).length && !E.custom.length) continue;
      const both = pick(0, 1).filter(n => v[1][n] === 1);
      txt += `\n${title}\nМэтчи (${both.length}): ${both.join(', ') || 'нет'}\n`;
      if (E.finals && E.finals.length) txt += `Финалисты второго круга: ${E.finals.join(', ')}\n`;
      [[0, P.dad], [1, P.mom]].forEach(([p, name]) => {
        txt += `${name} — нравится (${pick(p, 1).length}): ${pick(p, 1).join(', ') || 'нет'}\n`;
        txt += `${name} — не нравится (${pick(p, 0).length}): ${pick(p, 0).join(', ') || 'нет'}\n`;
      });
      if (E.custom.length) txt += `Свои имена: ${E.custom.map(e => e.n).join(', ')}\n`;
    }
  }
  const send = async (name, type, body, caption) => {
    const fd = new FormData(); fd.append('chat_id', to); fd.append('caption', caption);
    fd.append('document', new Blob([body], { type }), name);
    const r = await (await fetch(API + '/sendDocument', { method: 'POST', body: fd })).json();
    if (!r.ok) throw new Error(r.description);
  };
  await send('nashe-imya-svaypy.txt', 'text/plain', txt, 'Свайпы и мэтчи — для чтения');
  await send('nashe-imya-data.json', 'application/json', JSON.stringify({ app: 'nashe-imya', exported: new Date().toISOString(), users, rooms }), 'Полная копия данных — для переноса на новый сервер. Комнат: ' + ids.length);
  console.log('Готово: бот прислал вам два файла в Telegram.');
})().catch(e => { console.log('Ошибка: ' + e.message); process.exit(1); });
JS
