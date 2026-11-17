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
/* Если библиотека Telegram не загрузилась, берём данные входа прямо из адреса страницы и говорим с Telegram напрямую */
function hashInit() { try { return new URLSearchParams(location.hash.slice(1)).get('tgWebAppData') || ''; } catch (e) { return ''; } }
const initData = (tg && tg.initData) || hashInit();
function tgEvent(name, data) {
  try {
    const p = window.TelegramWebviewProxy, d = JSON.stringify(data || {});
    if (p && p.postEvent) p.postEvent(name, d);
    else if (window.parent !== window) window.parent.postMessage(JSON.stringify({ eventType: name, eventData: data || {} }), 'https://web.telegram.org');
  } catch (e) {}
}
let dev = ''; try { dev = new URLSearchParams(location.search).get('dev') || ''; } catch (e) {}
let S = null, G = null, CTX = [], GCODE = null, REMOTE = false, V = 0, INVITE = null, BOT = '', JOIN = null, FATAL = '', pending = 0, chain = Promise.resolve();
let U = LS.get('nashe-imya-ui') || { view: 'form', p: 0 };
let SEEN = LS.get('nashe-imya-seen') || { boy: [], girl: [] };
let ROOM = LS.get('nashe-imya-room') || '';       // какая комната открыта на этом устройстве
const saveU = () => LS.set('nashe-imya-ui', U);
/* Код из ссылки-приглашения (t.me/бот?startapp=КОД) и имя из Telegram — чтобы гостю не печатать */
function startParam() { try { return (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || new URLSearchParams(initData).get('start_param') || ''; } catch (e) { return ''; } }
function tgName() { try { return JSON.parse(new URLSearchParams(initData).get('user')).first_name || ''; } catch (e) { return ''; } }
const saveLocal = () => { if (!REMOTE) LS.set('nashe-imya-v1', S); };

async function api(method, url, body) {
  const r = await fetch(url, { method, cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Tg-Init': initData, 'X-Dev-User': dev, 'X-Room': ROOM },
    body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { FATAL = 'Не получилось войти. Закройте приложение и откройте его заново из Telegram.'; render(); throw new Error('auth'); }
  return r.json();
}
function take(resp, fromPoll) {
  if (resp.joined === false) { JOIN = { back: false }; S = null; G = null; CTX = []; render(); return; }
  if (!resp.state && !resp.gview) return;
  CTX = resp.ctx || []; ROOM = resp.room || ''; LS.set('nashe-imya-room', ROOM); BOT = resp.bot || ''; V = resp.v; JOIN = null;
  if (resp.guest) { G = resp.gview; S = null; render(); return; }
  const had = !!(S && S.d[S.g].r2);
  G = null; S = resp.state; INVITE = resp.invite || null; GCODE = resp.gcode || null; U.p = resp.p;
  if (fromPoll && !had && S.d[S.g].r2) toast(`${players()[1 - U.p]} запускает ${S.d[S.g].rn}-й круг: ${S.d[S.g].r2.names.length} имён.`);
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
const prof = () => G ? G.profile : S.profile;      // G — гостевой режим, S — режим родителей
const curG = () => G ? G.g : S.g;
const players = () => [prof().dad || 'Папа', prof().mom || 'Мама'];
const queue = () => G ? G.list.map(e => e.n) : Core.queue(S, U.p);
const r2q = () => G ? null : Core.r2q(S, U.p);
const topList = () => Core.top(S, S.g);
const supOk = () => !G && Core.supLeft(S, S.g, U.p) > 0 && !(S.d[S.g].r2 && !r2q());   // пока идёт круг, суперлайк только на его карточках
function fio(g, n) {
  const P = prof();
  return g === 'boy' ? `${P.surname} ${n} ${P.patr}` : `${femSurname(P.surname)} ${n} ${femPatr(P.patr)}`;
}
function initials(g, n) {
  const P = prof(), patr = g === 'boy' ? P.patr : femPatr(P.patr), sur = g === 'boy' ? P.surname : femSurname(P.surname);
  return `${n[0]}. ${patr ? patr[0] + '. ' : ''}${sur}`;
}

/* ---------- отрисовка ---------- */
let busy = false, toastT = 0, deckKey = '';
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 3400); }
function nameSize(n) { const l = n.length; return l <= 4 ? 64 : l <= 6 ? 52 : l <= 7 ? 42 : l <= 10 ? 34 : l <= 12 ? 28 : 24; }
function cardHTML(e, cls) {
  const g = curG();
  const forms = e.f.length
    ? `<div class="forms"><span class="lbl">Дома можно звать</span><ul class="chips">${e.f.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>`
    : e.c ? `<div class="forms"><span class="lbl">Это имя добавили вы</span></div>` : '';
  return `<article class="card ${cls}" data-n="${esc(e.n)}">
    <span class="wm" aria-hidden="true">${esc(e.n[0])}</span>
    <span class="stamp yes">Нравится</span><span class="stamp no">Не то</span><span class="stamp sup">★ Суперлайк</span>
    <div class="card-main">
      <span class="lbl">${r2q() ? S.d[g].rn + '-й круг' : G ? (g === 'boy' ? 'Имя для мальчика' : 'Имя для девочки') : e.c ? 'Своё имя' : SETS[e.s] || ''}</span>
      <h2 style="font-size:${nameSize(e.n)}px">${esc(e.n)}</h2>
      <p class="fio">${esc(fio(g, e.n))}</p>
      <p class="ini">В документах: ${esc(initials(g, e.n))}</p>
    </div>${forms}</article>`;
}
function renderDeck() {
  const q = queue(), st = $('#stack'), D = S.d[S.g], r2m = !!r2q();
  $('#left').textContent = r2m ? `${D.rn}-й круг: осталось ${q.length}` : q.length ? `Осталось имён: ${q.length}` : '';
  $('#add-open').hidden = r2m;
  $('#b-no').disabled = $('#b-yes').disabled = !q.length;
  $('#b-undo').disabled = !(r2m ? D.r2.hist[U.p] : D.hist[U.p]).length;
  $('#sup-left').textContent = Core.supLeft(S, S.g, U.p); $('#b-sup').disabled = !q.length || !supOk();
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
  const g = S.g, D = S.d[g], T = topList(), who = g === 'boy' ? 'мальчика' : 'девочки', pl = players();
  const info = n => T.find(x => x.e.n === n) || (Core.entry(S, g, n) ? { e: Core.entry(S, g, n), m: false, s: [false, false] } : null);
  const finals = (D.finals || []).map(info).filter(Boolean), fn = finals.map(x => x.e.n), rest = T.filter(x => !fn.includes(x.e.n));
  const item = x => {
    const gl = Object.keys(D.gv || {}).filter(id => D.gv[id][x.e.n] === 1 && S.guests[id]).map(id => S.guests[id].name);
    const marks = (x.m ? ['<span class="mark">Мэтч</span>'] : []).concat([0, 1].filter(p => x.s[p]).map(p => `<span class="mark"><i>★</i> ${esc(pl[p])}</span>`))
      .concat(gl.length ? [`<span class="mark"><i class="h">♥</i> Гости: ${gl.length}</span>`] : []);
    return `<div class="m">
      <div class="m-top"><b>${esc(x.e.n)}</b><button class="rm" type="button" data-rm="${esc(x.e.n)}">Убрать</button></div>
      <p class="full">${esc(fio(g, x.e.n))}</p>
      ${marks.length ? `<div class="marks">${marks.join('')}</div>` : ''}
      ${gl.length ? `<p>Нравится гостям: ${esc(gl.join(', '))}</p>` : ''}
      ${x.e.f.length ? `<p>${esc(x.e.f.join(', '))}</p>` : ''}</div>`;
  };
  $('#m-sub').textContent = T.length ? `В топе для ${who}: ${T.length}. Мэтчей: ${T.filter(x => x.m).length}, с суперлайком: ${T.filter(x => x.s[0] || x.s[1]).length}.` : '';
  if (!T.length && !finals.length) {
    $('#m-list').innerHTML = `<div class="empty"><h3>Топ для ${who} пока пуст</h3><p>Сюда попадают мэтчи — имена, которые лайкнули вы оба, — и имена с суперлайком.</p></div>`;
    return;
  }
  let ctl = '';
  if (D.r2) {
    const st = p => { const l = D.r2.names.filter(n => !(n in D.r2.votes[p])).length; return `${esc(pl[p])}: ${l ? 'осталось ' + l : 'готово'}`; };
    ctl = `<p class="note">Идёт ${D.rn}-й круг. ${st(0)}. ${st(1)}.</p>
      <button class="btn ghost" type="button" data-act="r2cancel">Отменить этот круг</button>`;
  } else {
    const next = (D.rn || 1) + 1, pool = finals.length >= 2 ? finals.length + rest.filter(x => x.s[0] || x.s[1]).length : T.length;
    if (pool >= 2) ctl = `<button class="btn" type="button" data-act="r2start">Начать ${next}-й круг</button>
      <p class="sub">Каждый заново свайпает ${pool} имён. Останутся те, что снова понравятся обоим, и имена с новым суперлайком. Старые суперлайки сгорают, на ${next}-й круг у каждого их ${Core.supQuota(next)}.</p>`;
    if (finals.length) ctl += `<button class="btn ghost" type="button" data-act="r2clear">Сбросить круги и суперлайки</button>`;
  }
  $('#m-list').innerHTML = ctl
    + (finals.length ? `<span class="lbl">Финалисты после ${D.r2 ? D.rn - 1 : D.rn}-го круга</span>` + finals.map(item).join('') : '')
    + (finals.length && rest.length ? `<span class="lbl">Остальной топ</span>` : '')
    + rest.map(item).join('');
}
const RM = {};                             // имена, у которых бежит отсчёт «Убрать»
/* мои лайки: всё, что я свайпнул вправо; здесь же можно поставить или снять суперлайк */
function renderLikes() {
  const g = S.g, D = S.d[g], p = U.p, v = D.votes[p], hist = D.hist[p], left = Core.supLeft(S, g, p);
  const mine = Core.all(S, g).filter(e => v[e.n] === 1).sort((a, b) => hist.lastIndexOf(b.n) - hist.lastIndexOf(a.n));
  $('#l-sub').textContent = mine.length ? `Имён: ${mine.length}. Суперлайков осталось: ${left}${D.r2 ? ' (пока идёт круг, здесь их ставить нельзя)' : ''}. Новые сверху.` : '';
  $('#l-list').innerHTML = mine.length ? mine.map(e => {
    const s = !!D.sup[p][e.n], m = D.votes[1 - p][e.n] === 1;
    const rm = RM[g + '|' + e.n];          // идёт трёхсекундный отсчёт перед снятием лайка
    return `<div class="lrow${m ? ' both' : ''}${rm ? ' going' : ''}">
      <div class="lmain"><b>${esc(e.n)}${m ? ' <span class="mark on">Мэтч</span>' : ''}</b><span>${rm ? 'Лайк снимается…' : esc(e.f.join(', '))}</span></div>
      <button class="star" type="button" data-sup="${esc(e.n)}" aria-pressed="${s}" ${rm ? 'disabled' : ''} aria-label="${s ? 'Снять суперлайк' : 'Поставить суперлайк'}">★</button>
      <button class="rm" type="button" data-unlike="${esc(e.n)}">${rm ? 'Отменить' : 'Убрать'}</button>
      ${rm ? `<i class="bar" style="animation-delay:-${Date.now() - rm.t0}ms"></i>` : ''}</div>`;
  }).join('') : `<div class="empty"><h3>Лайков пока нет</h3><p>Здесь появятся все имена, которые вы свайпнули вправо.</p></div>`;
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
  const K = JOIN.peek, home = CTX.some(x => x.role === 'parent');   // K — приглашение по ссылке; home — своя комната уже есть
  if (!JOIN.init) {
    JOIN.init = 1; $('#j-code').value = K ? JOIN.code : '';
    if (!$('#j-name').value) $('#j-name').value = tgName();
  }
  const asGuest = K ? K.kind === 'guest' : true, asParent = K ? K.kind === 'parent' : !home;
  $('#j-title').textContent = K ? 'Вас пригласили' : 'Добро пожаловать';
  $('#j-sub').textContent = !K ? 'Здесь двое выбирают имя малышу, а друзья и родные помогают голосованием.'
    : K.kind === 'guest' ? `${K.title} выбирают имя малышу и зовут вас проголосовать.` : `${K.title === 'Новая комната' ? 'Вас зовут' : K.title + ' зовут вас'} выбирать имя вместе.`;
  $('#j-code-f').hidden = !!K;
  $('#j-parent').hidden = !asParent; $('#j-guest-f').hidden = $('#j-guest').hidden = !asGuest;
  $('#j-0').hidden = !!(K && K.taken[0]); $('#j-1').hidden = !!(K && K.taken[1]);
  $('#j-hint').textContent = home ? 'Введите гостевой код: он начинается с буквы G.' : 'Вы первый из пары? Оставьте поле пустым: создадим вашу комнату и дадим код для второго.';
  $('#j-back').hidden = !JOIN.back;
}
/* гостевой экран: голосование по топу */
let gKey = '';
function renderGuest() {
  const pl = players(), left = G.list.length, st = $('#gstack');
  $('#g-title').textContent = 'Помогите выбрать имя';
  $('#g-sub').textContent = `${pl[0]} и ${pl[1]} выбирают имя ${G.g === 'boy' ? 'мальчику' : 'девочке'}. Вправо — нравится, влево — нет.` + (left ? ` Осталось: ${left} из ${G.total}.` : '');
  $('#g-actions').hidden = !left;
  const key = [ROOM, G.g, left ? G.list[0].n : '', left > 1 ? G.list[1].n : '', G.total, G.liked.length].join('|');
  if (key === gKey && (busy || st.firstElementChild)) return;
  gKey = key;
  if (!left) {
    st.innerHTML = G.total
      ? `<div class="empty"><h3>Спасибо${G.name ? ', ' + esc(G.name) : ''}!</h3><p>Вы оценили все имена. Если родители добавят новые, они появятся здесь.</p>${G.liked.length ? `<p>Вам понравились: ${esc(G.liked.join(', '))}</p>` : ''}</div>`
      : `<div class="empty"><h3>Пока нечего оценивать</h3><p>Родители ещё выбирают. Загляните позже: имена появятся здесь.</p></div>`;
    return;
  }
  st.innerHTML = (G.list[1] ? cardHTML(G.list[1], 'next') : '') + cardHTML(G.list[0], 'top');
  bindCard(st.querySelector('.card.top'));
}
function renderRooms() {
  $('#rooms-list').innerHTML = CTX.map(x => `<button class="rowbtn" type="button" data-room="${esc(x.id)}" aria-pressed="${x.id === ROOM}">
    <b>${esc(x.title)}</b><span>${x.role === 'parent' ? 'ваша комната' : 'вы гость'}${x.id === ROOM ? ' · открыта сейчас' : ''}</span></button>`).join('');
}
function render() {
  const show = FATAL ? 'fatal' : JOIN ? 'join' : G ? 'guest' : !S ? 'fatal' : U.view;
  ['form', 'deck', 'matches', 'likes', 'join', 'fatal', 'guest'].forEach(v => $('#v-' + v).hidden = v !== show);
  $('#tabs').hidden = show === 'fatal' || show === 'join' || show === 'guest';
  $('#who').hidden = REMOTE || show !== 'deck';
  if (show === 'fatal') { $('#fatal-text').textContent = FATAL || 'Загружаем…'; return; }
  if (show === 'join') { renderJoin(); return; }
  document.body.dataset.g = curG();
  if (show === 'guest') { renderGuest(); return; }
  document.querySelectorAll('#seg-g button').forEach(b => b.setAttribute('aria-pressed', b.dataset.g === S.g));
  const pl = players();
  document.querySelectorAll('#seg-p button').forEach(b => { b.textContent = pl[+b.dataset.p]; b.setAttribute('aria-pressed', +b.dataset.p === U.p); });
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === U.view));
  const mc = topList().length, bd = $('#badge'); bd.hidden = !mc; bd.textContent = mc;
  $('#invite').hidden = !INVITE;
  if (INVITE) { $('#invite-code').textContent = INVITE; $('#inv-share').hidden = !(initData && BOT); }
  $('#guest-box').hidden = !(REMOTE && GCODE);
  if (REMOTE && GCODE) {
    $('#guest-code').textContent = GCODE; $('#g-share').hidden = !(initData && BOT);
    const T = topList(), gv = S.d[S.g].gv || {}, ids = Object.keys(S.guests || {});
    $('#guest-list').innerHTML = ids.length
      ? ids.map(id => `<p>${esc(S.guests[id].name)}: оценено ${T.filter(x => gv[id] && x.e.n in gv[id]).length} из ${T.length}</p>`).join('')
      : '<p>Гостей пока нет.</p>';
  }
  $('#rooms-open').hidden = !REMOTE;
  const rb = $('#f-reset'); rb.dataset.label = REMOTE ? 'Сбросить всё у обоих: свайпы и свои имена' : 'Сбросить все свайпы и свои имена';
  if (!rb.armed()) rb.textContent = rb.dataset.label;
  if (show === 'deck') renderDeck();
  if (show === 'matches') renderMatches();
  if (show === 'likes') renderLikes();
  if (show === 'form') renderSets();
  checkMatches();
}
function go(view) { U.view = view; saveU(); if (view === 'form') renderForm(); render(); }

/* ---------- мэтч: показываем каждому, кто его ещё не видел ---------- */
function checkMatches() {
  if (!$('#match').hidden) return;
  const seen = SEEN[S.g] || (SEEN[S.g] = []), pl = players();
  const show = (key, title, who, n) => {
    seen.push(key); LS.set('nashe-imya-seen', SEEN);
    $('#match-title').textContent = title; $('#match-who').textContent = who;
    $('#match-name').textContent = n; $('#match-fio').textContent = fio(S.g, n);
    $('#match').hidden = false; $('#match-next').focus();
    try { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success'); } catch (x) {}
  };
  for (const x of topList()) {
    const n = x.e.n;
    if (x.m && !seen.includes(n)) return show(n, 'Это мэтч!', `${pl[0]} и ${pl[1]} выбрали`, n);
    if (REMOTE && !x.m && x.s[1 - U.p] && !seen.includes('★' + n)) return show('★' + n, 'Суперлайк!', `${pl[1 - U.p]}: очень хочу это имя`, n);
  }
}

/* ---------- свайпы ---------- */
function setStamp(el, dx, dy) {
  const c = v => Math.max(0, Math.min(1, v)), up = dy !== undefined && -dy > Math.abs(dx) && supOk() ? c(-dy / 110) : 0;
  el.querySelector('.stamp.yes').style.opacity = up ? 0 : c(dx / 90);
  el.querySelector('.stamp.no').style.opacity = up ? 0 : c(-dx / 90);
  el.querySelector('.stamp.sup').style.opacity = up;
}
function bindCard(el) {
  let sx = 0, sy = 0, dx = 0, dy = 0, drag = false;
  el.onpointerdown = e => { if (busy) return; drag = true; sx = e.clientX; sy = e.clientY; dx = dy = 0; try { el.setPointerCapture(e.pointerId); } catch (x) {} el.style.transition = 'none'; };
  el.onpointermove = e => {
    if (!drag) return; dx = e.clientX - sx; dy = e.clientY - sy;
    el.style.transform = `translate(${dx}px,${dy < 0 ? dy * .7 : dy * .25}px) rotate(${dx / 20}deg)`; setStamp(el, dx, dy);
  };
  const end = () => {
    if (!drag) return; drag = false; el.style.transition = '';
    if (-dy > 110 && Math.abs(dx) < 90 && supOk()) fly(true, true);      // свайп вверх — суперлайк
    else if (Math.abs(dx) > 90) fly(dx > 0);
    else { el.style.transform = ''; setStamp(el, 0, 0); }
  };
  el.onpointerup = end; el.onpointercancel = end;
}
function fly(like, sup) {
  if (busy || !(S || G)) return; const q = queue(); if (!q.length) return;
  if (sup && !supOk()) return;
  const el = $('.view:not([hidden]) .card.top'); if (!el || el.dataset.n !== q[0]) return;
  busy = true;
  el.style.transition = 'transform .26s ease-in, opacity .26s';
  el.style.transform = sup ? 'translate(0,-640px)' : `translate(${like ? 520 : -520}px,40px) rotate(${like ? 24 : -24}deg)`; el.style.opacity = 0;
  if (sup) setStamp(el, 0, -200); else setStamp(el, like ? 200 : -200, 0);
  setTimeout(() => { busy = false; commit(q[0], like, sup); }, 240);
}
function commit(n, like, sup) {
  if (G) {                       // гость: голос уходит на сервер, карточка убирается сразу
    G.list = G.list.filter(e => e.n !== n); if (like) G.liked.push(n);
    send({ t: 'gvote', n, like }); render(); return;
  }
  const r = actNow({ t: 'vote', g: S.g, n, like, sup: !!sup, r2: !!r2q() }), ev = r.ev || {};
  if (ev.r2done !== undefined) {
    U.view = 'matches'; saveU();
    toast(ev.r2done ? `Круг завершён. Финалистов: ${ev.r2done}` : 'Круг завершён. Общих имён не осталось, топ на месте.');
  } else if (ev.r2mine) toast(`Вы прошли круг. Теперь очередь: ${players()[1 - U.p]}.`);
  else if (ev.nosup) toast('Суперлайки закончились, поставлен обычный лайк');
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
$('#b-sup').onclick = () => fly(true, true);
$('#g-yes').onclick = () => fly(true);
$('#g-no').onclick = () => fly(false);
$('#b-undo').onclick = () => { if (busy) return; actNow({ t: 'undo', g: S.g, r2: !!r2q() }); render(); };
document.addEventListener('keydown', e => {
  if (!(S || G) || JOIN || (S && U.view !== 'deck') || !$('#add').hidden || !$('#match').hidden || !$('#rooms').hidden || /INPUT/.test(e.target.tagName)) return;
  if (e.key === 'ArrowRight') fly(true); if (e.key === 'ArrowLeft') fly(false); if (e.key === 'ArrowUp') fly(true, true);
});
$('#m-list').onclick = async e => {
  const a = e.target.closest('[data-act]');
  if (a) {
    const act = a.dataset.act, r = await actWait({ t: act, g: S.g });
    if (r.err) { toast(r.err); return; }
    if (act === 'r2start') { toast(`Круг начался: ${r.ev.r2start} имён. ${REMOTE ? 'Свайпайте каждый у себя.' : 'Свайпайте по очереди.'}`); go('deck'); }
    if (act === 'r2cancel') toast('Круг отменён, суперлайки возвращены');
    return;
  }
  const b = e.target.closest('[data-rm]'); if (!b) return;
  const r = await actWait({ t: 'unmatch', g: S.g, n: b.dataset.rm }); if (!r.err) toast(`«${b.dataset.rm}» убрано из топа`);
};
$('#l-list').onclick = async e => {
  const s = e.target.closest('[data-sup]'), u = e.target.closest('[data-unlike]');
  if (s) { const r = await actWait({ t: 'sup', g: S.g, n: s.dataset.sup, on: s.getAttribute('aria-pressed') !== 'true' }); if (r.err) toast(r.err); }
  if (u) {
    const g = S.g, n = u.dataset.unlike, key = g + '|' + n;
    if (RM[key]) { clearTimeout(RM[key].timer); delete RM[key]; renderLikes(); return; }     // успели отменить
    RM[key] = { t0: Date.now(), timer: setTimeout(async () => {
      delete RM[key];
      const r = await actWait({ t: 'unmatch', g, n }); if (!r.err) toast(`Лайк с имени «${n}» снят`);
    }, 3000) };
    renderLikes();
  }
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
function twoTap(b, fn) {          // опасные кнопки срабатывают со второго нажатия
  let t = 0;
  b.armed = () => !!t;
  b.onclick = async () => {
    if (!t) { t = setTimeout(() => { t = 0; b.textContent = b.dataset.label; }, 4000); b.textContent = 'Нажмите ещё раз, чтобы сбросить'; return; }
    clearTimeout(t); t = 0; b.textContent = b.dataset.label; await fn();
  };
}
const forgetSeen = () => { SEEN = { boy: [], girl: [] }; LS.set('nashe-imya-seen', SEEN); };
twoTap($('#f-resetme'), async () => { const r = await actWait({ t: 'resetme' }); if (!r.err) { forgetSeen(); deckKey = ''; render(); toast('Ваши свайпы сброшены, имена перемешаны заново'); } });
twoTap($('#f-reset'), async () => { const r = await actWait({ t: 'reset' }); if (!r.err) { forgetSeen(); deckKey = ''; render(); toast('Свайпы и свои имена сброшены'); } });

/* приглашения: второму родителю и гостям */
const botLink = () => BOT ? 'https://t.me/' + BOT : '';
const deepLink = code => BOT ? 'https://t.me/' + BOT + '?startapp=' + code : '';
const inviteText = link => `Выбираем имя малышу вместе.${link && BOT ? ' Открой ссылку: ' + deepLink(INVITE) : ''} Если ссылка не сработает: нажми в боте «Открыть» и введи код ${INVITE}`;
const guestText = link => `Помоги нам выбрать имя малышу.${link && BOT ? ' Открой ссылку: ' + deepLink(GCODE) : ''} Если ссылка не сработает: нажми в боте «Открыть», введи код ${GCODE} и нажми «Я гость».`;
function copyText(text, fallbackHint) {
  const done = () => toast('Приглашение скопировано'), fallback = () => {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove(); ok ? done() : toast('Не получилось скопировать. ' + fallbackHint);
  };
  try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
}
function shareText(text, code) {
  const url = 'https://t.me/share/url?url=' + encodeURIComponent(deepLink(code)) + '&text=' + encodeURIComponent(text);
  try { if (tg && tg.openTelegramLink) tg.openTelegramLink(url); else tgEvent('web_app_open_tg_link', { path_full: url.replace('https://t.me', '') }); } catch (e) { toast('Не получилось открыть Telegram. Скопируйте приглашение.'); }
}
$('#inv-copy').onclick = () => copyText(inviteText(true), 'Код: ' + INVITE);
$('#inv-share').onclick = () => shareText(inviteText(false), INVITE);
$('#g-copy').onclick = () => copyText(guestText(true), 'Код: ' + GCODE);
$('#g-share').onclick = () => shareText(guestText(false), GCODE);

/* комнаты: своя и те, где вы гость */
const openRooms = () => { renderRooms(); $('#rooms').hidden = false; };
$('#rooms-open').onclick = openRooms; $('#g-rooms').onclick = openRooms;
$('#rooms-close').onclick = () => $('#rooms').hidden = true;
$('#rooms').onclick = e => { if (e.target.id === 'rooms') $('#rooms').hidden = true; };
$('#rooms-add').onclick = () => { $('#rooms').hidden = true; $('#j-err').textContent = ''; JOIN = { back: true }; render(); };
$('#rooms-list').onclick = async e => {
  const b = e.target.closest('[data-room]'); if (!b) return;
  $('#rooms').hidden = true; if (b.dataset.room === ROOM) return;
  ROOM = b.dataset.room; deckKey = gKey = '';
  try { const r = await api('GET', 'api/state'); take(r); if (S && U.view === 'form') renderForm(); } catch (x) { if (!FATAL) toast('Нет связи. Попробуйте ещё раз.'); }
};
$('#j-back').onclick = () => { JOIN = null; render(); };

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

/* вход (только общий режим): родитель или гость */
$('#v-join').onclick = async e => {
  const b = e.target.closest('[data-role]'); if (!b || b.disabled) return;
  $('#j-err').textContent = '';
  try {
    const role = b.dataset.role === 'guest' ? 'guest' : +b.dataset.role;
    const r = await api('POST', 'api/join', { role, code: JOIN.peek ? JOIN.code : $('#j-code').value, name: $('#j-name').value });
    if (r.err) { $('#j-err').textContent = r.err; return; }
    if (r.state) { U.view = r.state.profile.example ? 'form' : 'deck'; saveU(); }
    deckKey = gKey = ''; take(r); if (S && U.view === 'form') renderForm();
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
    if (tg && tg.initData) { tg.ready(); tg.expand(); if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); }
    else if (initData) { tgEvent('web_app_ready'); tgEvent('web_app_expand'); tgEvent('web_app_setup_swipe_behavior', { allow_vertical_swipe: false }); }
    const r = await api('GET', 'api/state');
    if (r.state && !LS.get('nashe-imya-ui')) U.view = r.state.profile.example ? 'form' : 'deck';
    take(r); if (S && U.view === 'form') renderForm();
    const sp = startParam();                 // открыли по ссылке-приглашению
    if (sp) {
      const k = await api('GET', 'api/peek?code=' + encodeURIComponent(sp));
      if (k.found && k.member) { if (k.room !== ROOM) { ROOM = k.room; take(await api('GET', 'api/state')); if (S && U.view === 'form') renderForm(); } }
      else if (k.found) { JOIN = { back: CTX.length > 0, peek: k, code: sp }; render(); }
    }
  } catch (e) { if (!FATAL) { FATAL = 'Нет связи с сервером. Проверьте интернет и откройте приложение заново.'; render(); } }
  const poll = () => {
    if (FATAL || document.hidden || pending || (JOIN && JOIN.back)) return;
    api('GET', 'api/state?v=' + (JOIN ? 0 : V) + '&r=' + encodeURIComponent(ROOM)).then(r => { if (!r.same && !pending) take(r, true); }).catch(() => {});
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
