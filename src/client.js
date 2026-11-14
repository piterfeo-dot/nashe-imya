const { BASE, SETS, cap, patronymic, femPatr, femSurname } = Core;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

/* ---------- где мы запущены ----------
   REMOTE = страница открыта с нашего сервера (Telegram): состояние общее, лежит на сервере.
   Иначе — прототип: всё хранится в этом браузере, оба игрока на одном экране. */
const tg = window.Telegram && window.Telegram.WebApp;
const initData = (tg && tg.initData) || '';
let dev = ''; try { dev = new URLSearchParams(location.search).get('dev') || ''; } catch (e) {}
let S = null, REMOTE = false, V = 0, INVITE = null, JOIN = null, FATAL = '', pending = 0, chain = Promise.resolve();
let U = LS.get('nashe-imya-ui') || { view: 'form', p: 0 };
let SEEN = LS.get('nashe-imya-seen') || { boy: [], girl: [] };
const saveU = () => LS.set('nashe-imya-ui', U);
const saveLocal = () => { if (!REMOTE) LS.set('nashe-imya-v1', S); };

async function api(method, url, body) {
  const r = await fetch(url, { method, cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Tg-Init': initData, 'X-Dev-User': dev },
    body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { FATAL = 'Не получилось войти. Закройте приложение и откройте его заново из Telegram.'; render(); throw new Error('auth'); }
  return r.json();
}
function take(resp, fromPoll) {
  if (resp.joined === false) { JOIN = resp; S = null; render(); return; }
  if (!resp.state) return;
  const had = !!(S && S.d[S.g].r2);
  JOIN = null; S = resp.state; V = resp.v; INVITE = resp.invite || null; U.p = resp.p;
  if (fromPoll && !had && S.d[S.g].r2) toast(`${players()[1 - U.p]} запускает второй круг: ${S.d[S.g].r2.names.length} имён.`);
  render();
}
function send(a) {
  pending++;
  chain = chain.then(() => api('POST', 'api/act', { a })).then(resp => { pending--; if (pending === 0) take(resp); return resp; },
    () => { pending--; if (!FATAL) { toast('Нет связи. Проверьте интернет.'); api('GET', 'api/state').then(r => take(r)).catch(() => {}); } return { err: 'Нет связи. Попробуйте ещё раз.' }; });
  return chain;
}
/* быстрые действия (свайп, отмена): сразу меняем экран, серверу отправляем следом */
function actNow(a) { const r = Core.apply(S, U.p, a); if (REMOTE) send(a); else saveLocal(); return r; }
/* остальные действия: в общем режиме ждём ответ сервера */
async function actWait(a) {
  if (!REMOTE) { const r = Core.apply(S, U.p, a); saveLocal(); render(); return r; }
  const r = await send(a); render(); return r;
}

/* ---------- данные для экрана ---------- */
const players = () => [S.profile.dad || 'Папа', S.profile.mom || 'Мама'];
const queue = () => Core.queue(S, U.p);
const r2q = () => Core.r2q(S, U.p);
const matches = g => Core.matches(S, g);
function fio(g, n) {
  const P = S.profile;
  return g === 'boy' ? `${P.surname} ${n} ${P.patr}` : `${femSurname(P.surname)} ${n} ${femPatr(P.patr)}`;
}
function initials(g, n) {
  const P = S.profile, patr = g === 'boy' ? P.patr : femPatr(P.patr), sur = g === 'boy' ? P.surname : femSurname(P.surname);
  return `${n[0]}. ${patr ? patr[0] + '. ' : ''}${sur}`;
}

/* ---------- отрисовка ---------- */
let busy = false, toastT = 0, deckKey = '';
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 3400); }
function nameSize(n) { const l = n.length; return l <= 4 ? 64 : l <= 6 ? 52 : l <= 7 ? 42 : l <= 10 ? 34 : l <= 12 ? 28 : 24; }
function cardHTML(e, cls) {
  const g = S.g;
  const forms = e.f.length
    ? `<div class="forms"><span class="lbl">Дома можно звать</span><ul class="chips">${e.f.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>`
    : e.c ? `<div class="forms"><span class="lbl">Это имя добавили вы</span></div>` : '';
  return `<article class="card ${cls}" data-n="${esc(e.n)}">
    <span class="wm" aria-hidden="true">${esc(e.n[0])}</span>
    <span class="stamp yes">Нравится</span><span class="stamp no">Не то</span>
    <div class="card-main">
      <span class="lbl">${r2q() ? 'Второй круг' : g === 'boy' ? 'Мальчик' : 'Девочка'}</span>
      <h2 style="font-size:${nameSize(e.n)}px">${esc(e.n)}</h2>
      <p class="fio">${esc(fio(g, e.n))}</p>
      <p class="ini">В документах: ${esc(initials(g, e.n))}</p>
    </div>${forms}</article>`;
}
function renderDeck() {
  const q = queue(), st = $('#stack'), D = S.d[S.g], r2m = !!r2q();
  $('#left').textContent = r2m ? `Второй круг: осталось ${q.length}` : q.length ? `Осталось имён: ${q.length}` : '';
  $('#add-open').hidden = r2m;
  $('#b-no').disabled = $('#b-yes').disabled = !q.length;
  $('#b-undo').disabled = !(r2m ? D.r2.hist[U.p] : D.hist[U.p]).length;
  const key = [S.g, U.p, r2m, q[0], q[1], JSON.stringify(S.profile)].join('|');
  if (key === deckKey && (busy || st.firstElementChild)) return;   // не перерисовываем карточку, которую сейчас тянут
  deckKey = key;
  if (!q.length) {
    st.innerHTML = `<div class="empty"><h3>${esc(players()[U.p])}, имена закончились</h3>
      <p>${REMOTE ? 'Добавьте своё имя или включите ещё один набор в настройках.' : `Добавьте своё имя или передайте телефон: пусть свайпает ${esc(players()[1 - U.p])}.`}</p></div>`;
    return;
  }
  st.innerHTML = (q[1] ? cardHTML(Core.entry(S, S.g, q[1]), 'next') : '') + cardHTML(Core.entry(S, S.g, q[0]), 'top');
  bindCard(st.querySelector('.card.top'));
}
function renderMatches() {
  const D = S.d[S.g], ms = matches(S.g), who = S.g === 'boy' ? 'мальчика' : 'девочки', pl = players();
  const finals = (D.finals || []).filter(n => ms.some(e => e.n === n));
  const item = e => `<div class="m">
      <div class="m-top"><b>${esc(e.n)}</b><button class="rm" type="button" data-rm="${esc(e.n)}">Убрать</button></div>
      <p class="full">${esc(fio(S.g, e.n))}</p>
      ${e.f.length ? `<p>${esc(e.f.join(', '))}</p>` : ''}</div>`;
  $('#m-sub').textContent = ms.length ? `Имена для ${who}, которые нравятся вам обоим: ${ms.length}` : '';
  if (!ms.length) {
    $('#m-list').innerHTML = `<div class="empty"><h3>Пока нет мэтчей для ${who}</h3><p>Мэтч появится, когда вы оба поставите лайк одному имени.</p></div>`;
    return;
  }
  let ctl = '';
  if (D.r2) {
    const st = p => { const l = D.r2.names.filter(n => !(n in D.r2.votes[p])).length; return `${esc(pl[p])}: ${l ? 'осталось ' + l : 'готово'}`; };
    ctl = `<p class="note">Идёт второй круг. ${st(0)}. ${st(1)}.</p>
      <button class="btn ghost" type="button" data-act="r2cancel">Отменить второй круг</button>`;
  } else {
    const pool = finals.length >= 2 ? finals.length : ms.length;
    if (pool >= 2) ctl = `<button class="btn" type="button" data-act="r2start">${finals.length >= 2 ? 'Ещё один круг среди финалистов' : 'Начать второй круг'}</button>
      <p class="sub">Каждый заново свайпает ${pool} ${finals.length >= 2 ? 'финалистов' : 'мэтчей'}. Останутся имена, которые снова понравятся обоим.</p>`;
    if (finals.length) ctl += `<button class="btn ghost" type="button" data-act="r2clear">Сбросить финалистов</button>`;
  }
  const rest = ms.filter(e => !finals.includes(e.n));
  $('#m-list').innerHTML = ctl
    + (finals.length ? `<span class="lbl">Финалисты второго круга</span>` + ms.filter(e => finals.includes(e.n)).map(item).join('') : '')
    + (finals.length && rest.length ? `<span class="lbl">Остальные мэтчи</span>` : '')
    + rest.map(item).join('');
}
let patrManual = false;
function renderForm() {
  const P = S.profile;
  $('#f-sur').value = P.surname; $('#f-dad').value = P.dad; $('#f-patr').value = P.patr; $('#f-mom').value = P.mom;
  patrManual = !P.example && P.patr !== patronymic(P.dad);
  $('#ex-note').hidden = !P.example;
  $('#f-save').textContent = P.example ? 'Начать выбирать' : 'Сохранить';
  $('#f-err').textContent = '';
  preview();
}
function renderSets() {
  $('#sets').innerHTML = Object.keys(SETS).map(k => `<button type="button" data-set="${k}" aria-pressed="${!!S.sets[k]}">
    <i aria-hidden="true">${S.sets[k] ? '✓' : ''}</i><span>${SETS[k]}</span><em>${BASE[S.g].filter(e => e.s === k).length}</em></button>`).join('');
}
function preview() {
  const sur = cap($('#f-sur').value), patr = cap($('#f-patr').value);
  $('#pv-boy').textContent = `${sur} Лев ${patr}`.trim();
  $('#pv-girl').textContent = `${femSurname(sur)} Алиса ${femPatr(patr)}`.trim();
}
function renderJoin() {
  const f = $('#j-code');
  if (!f.dataset.init) { f.dataset.init = 1; try { f.value = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || ''; } catch (e) {} }
}
function render() {
  const show = FATAL ? 'fatal' : JOIN ? 'join' : !S ? 'fatal' : U.view;
  ['form', 'deck', 'matches', 'join', 'fatal'].forEach(v => $('#v-' + v).hidden = v !== show);
  $('#tabs').hidden = show === 'fatal' || show === 'join';
  $('#who').hidden = REMOTE || show !== 'deck';
  if (show === 'fatal') { $('#fatal-text').textContent = FATAL || 'Загружаем…'; return; }
  if (show === 'join') { renderJoin(); return; }
  document.body.dataset.g = S.g;
  document.querySelectorAll('#seg-g button').forEach(b => b.setAttribute('aria-pressed', b.dataset.g === S.g));
  const pl = players();
  document.querySelectorAll('#seg-p button').forEach(b => { b.textContent = pl[+b.dataset.p]; b.setAttribute('aria-pressed', +b.dataset.p === U.p); });
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === U.view));
  const mc = matches(S.g).length, bd = $('#badge'); bd.hidden = !mc; bd.textContent = mc;
  const inv = $('#invite-note'); inv.hidden = !INVITE;
  if (INVITE) inv.textContent = `Код приглашения для второго участника: ${INVITE}. Отправьте его: второй участник введёт код при первом входе.`;
  $('#f-reset').dataset.label = REMOTE ? 'Сбросить все свайпы и свои имена у обоих' : 'Сбросить все свайпы и свои имена';
  if (!resetArmed) $('#f-reset').textContent = $('#f-reset').dataset.label;
  if (show === 'deck') renderDeck();
  if (show === 'matches') renderMatches();
  if (show === 'form') renderSets();
  checkMatches();
}
function go(view) { U.view = view; saveU(); if (view === 'form') renderForm(); render(); }

/* ---------- мэтч: показываем каждому, кто его ещё не видел ---------- */
function checkMatches() {
  if (!$('#match').hidden) return;
  const seen = SEEN[S.g] || (SEEN[S.g] = []), e = matches(S.g).find(x => !seen.includes(x.n));
  if (!e) return;
  seen.push(e.n); LS.set('nashe-imya-seen', SEEN);
  const pl = players();
  $('#match-who').textContent = `${pl[0]} и ${pl[1]} выбрали`;
  $('#match-name').textContent = e.n; $('#match-fio').textContent = fio(S.g, e.n);
  $('#match').hidden = false; $('#match-next').focus();
  try { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success'); } catch (x) {}
}

/* ---------- свайпы ---------- */
function setStamp(el, dx) {
  el.querySelector('.stamp.yes').style.opacity = Math.max(0, Math.min(1, dx / 90));
  el.querySelector('.stamp.no').style.opacity = Math.max(0, Math.min(1, -dx / 90));
}
function bindCard(el) {
  let sx = 0, sy = 0, dx = 0, drag = false;
  el.onpointerdown = e => { if (busy) return; drag = true; sx = e.clientX; sy = e.clientY; dx = 0; try { el.setPointerCapture(e.pointerId); } catch (x) {} el.style.transition = 'none'; };
  el.onpointermove = e => { if (!drag) return; dx = e.clientX - sx; el.style.transform = `translate(${dx}px,${(e.clientY - sy) * .25}px) rotate(${dx / 20}deg)`; setStamp(el, dx); };
  const end = () => { if (!drag) return; drag = false; el.style.transition = ''; if (Math.abs(dx) > 90) fly(dx > 0); else { el.style.transform = ''; setStamp(el, 0); } };
  el.onpointerup = end; el.onpointercancel = end;
}
function fly(like) {
  if (busy || !S) return; const q = queue(); if (!q.length) return;
  const el = $('.card.top'); if (!el || el.dataset.n !== q[0]) return;
  busy = true;
  el.style.transition = 'transform .26s ease-in, opacity .26s';
  el.style.transform = `translate(${like ? 520 : -520}px,40px) rotate(${like ? 24 : -24}deg)`; el.style.opacity = 0;
  setStamp(el, like ? 200 : -200);
  setTimeout(() => { busy = false; commit(q[0], like); }, 240);
}
function commit(n, like) {
  const r = actNow({ t: 'vote', g: S.g, n, like, r2: !!r2q() }), ev = r.ev || {};
  if (ev.r2done !== undefined) {
    U.view = 'matches'; saveU();
    toast(ev.r2done ? `Второй круг завершён. Финалистов: ${ev.r2done}` : 'Второй круг завершён. Общих имён не осталось, мэтчи на месте.');
  } else if (ev.r2mine) toast(`Вы прошли второй круг. Теперь очередь: ${players()[1 - U.p]}.`);
  render();
}

/* ---------- события ---------- */
$('#seg-g').onclick = async e => { const b = e.target.closest('button'); if (!b) return; await actWait({ t: 'setg', g: b.dataset.g }); };
$('#sets').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return; const k = b.dataset.set;
  const r = await actWait({ t: 'sets', k, on: !S.sets[k] }); if (r.err) toast(r.err);
};
$('#seg-p').onclick = e => { const b = e.target.closest('button'); if (!b) return; U.p = +b.dataset.p; saveU(); render(); };
$('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) go(b.dataset.v); };
$('#b-yes').onclick = () => fly(true);
$('#b-no').onclick = () => fly(false);
$('#b-undo').onclick = () => { if (busy) return; actNow({ t: 'undo', g: S.g, r2: !!r2q() }); render(); };
document.addEventListener('keydown', e => {
  if (!S || JOIN || U.view !== 'deck' || !$('#add').hidden || !$('#match').hidden || /INPUT/.test(e.target.tagName)) return;
  if (e.key === 'ArrowRight') fly(true); if (e.key === 'ArrowLeft') fly(false);
});
$('#m-list').onclick = async e => {
  const a = e.target.closest('[data-act]');
  if (a) {
    const act = a.dataset.act, r = await actWait({ t: act, g: S.g });
    if (r.err) { toast(r.err); return; }
    if (act === 'r2start') { toast(`Второй круг начался: ${r.ev.r2start} имён. ${REMOTE ? 'Свайпайте каждый у себя.' : 'Свайпайте по очереди.'}`); go('deck'); }
    if (act === 'r2cancel') toast('Второй круг отменён');
    return;
  }
  const b = e.target.closest('[data-rm]'); if (!b) return;
  const r = await actWait({ t: 'unmatch', g: S.g, n: b.dataset.rm }); if (!r.err) toast(`«${b.dataset.rm}» убрано из мэтчей`);
};
$('#match-next').onclick = () => { $('#match').hidden = true; checkMatches(); };
$('#match-open').onclick = () => { $('#match').hidden = true; go('matches'); };

/* настройки */
$('#f-dad').oninput = () => { if (!patrManual) $('#f-patr').value = patronymic($('#f-dad').value); preview(); };
$('#f-patr').oninput = () => { patrManual = true; preview(); };
$('#f-sur').oninput = preview;
$('#form').onsubmit = async e => {
  e.preventDefault();
  const r = await actWait({ t: 'profile', surname: $('#f-sur').value, dad: $('#f-dad').value, patr: $('#f-patr').value, mom: $('#f-mom').value });
  if (r.err) { $('#f-err').textContent = r.err; return; }
  go('deck');
};
let resetArmed = 0;
$('#f-reset').onclick = async () => {
  const b = $('#f-reset');
  if (!resetArmed) { resetArmed = setTimeout(() => { resetArmed = 0; b.textContent = b.dataset.label; }, 4000); b.textContent = 'Нажмите ещё раз, чтобы сбросить'; return; }
  clearTimeout(resetArmed); resetArmed = 0; b.textContent = b.dataset.label;
  const r = await actWait({ t: 'reset' });
  if (!r.err) { SEEN = { boy: [], girl: [] }; LS.set('nashe-imya-seen', SEEN); toast('Свайпы и свои имена сброшены'); }
};

/* своё имя */
$('#add-open').onclick = () => {
  $('#add-label').textContent = S.g === 'boy' ? 'Имя для мальчика' : 'Имя для девочки';
  $('#add-name').value = ''; $('#add-err').textContent = ''; $('#add').hidden = false; $('#add-name').focus();
};
$('#add-close').onclick = () => $('#add').hidden = true;
$('#add').onclick = e => { if (e.target.id === 'add') $('#add').hidden = true; };
$('#add-form').onsubmit = async e => {
  e.preventDefault();
  const r = await actWait({ t: 'add', g: S.g, name: $('#add-name').value });
  if (r.err) { $('#add-err').textContent = r.err; return; }
  $('#add').hidden = true;
  toast(`«${r.ev.added}» добавлено. Ваш лайк стоит, имя скоро выпадет у ${players()[1 - U.p]}.`);
};

/* вход (только общий режим) */
$('#v-join').onclick = async e => {
  const b = e.target.closest('[data-role]'); if (!b || b.disabled) return;
  $('#j-err').textContent = '';
  try {
    const r = await api('POST', 'api/join', { role: +b.dataset.role, code: $('#j-code').value });
    if (r.err) { $('#j-err').textContent = r.err; return; }
    U.view = r.state.profile.example ? 'form' : 'deck'; saveU(); take(r); if (U.view === 'form') renderForm();
  } catch (x) { if (!FATAL) $('#j-err').textContent = 'Нет связи. Попробуйте ещё раз.'; }
};

/* ---------- запуск ---------- */
function startLocal() {
  const old = LS.get('nashe-imya-v1');
  S = old && old.d && old.profile ? old : Core.fresh();
  if (S.view) { U.view = S.view; U.p = S.p || 0; delete S.view; delete S.p; saveU(); }
  Core.migrate(S); saveLocal();
  if (U.view === 'form') renderForm();
  render();
}
async function startRemote() {
  REMOTE = true; render();
  try {
    if (tg && initData) { tg.ready(); tg.expand(); if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); }
    const r = await api('GET', 'api/state');
    if (r.joined !== false && !LS.get('nashe-imya-ui')) U.view = r.state.profile.example ? 'form' : 'deck';
    take(r); if (S && U.view === 'form') renderForm();
  } catch (e) { if (!FATAL) { FATAL = 'Нет связи с сервером. Проверьте интернет и откройте приложение заново.'; render(); } }
  const poll = () => {
    if (FATAL || document.hidden || pending) return;
    api('GET', 'api/state?v=' + (JOIN ? 0 : V)).then(r => { if (!r.same && !pending) take(r, true); }).catch(() => {});
  };
  setInterval(poll, 4000);
  document.addEventListener('visibilitychange', poll);
}
if (initData || dev) startRemote();
else {
  startLocal();
  if (/^http/.test(location.protocol)) fetch('api/ping').then(r => r.ok ? r.json() : null).then(j => {
    if (j && j.app === 'nashe-imya') { S = null; FATAL = 'Откройте приложение через Telegram: кнопка в чате с ботом.'; render(); }
  }).catch(() => {});
}
