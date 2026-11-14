
/* ---------- текст: формы имён ---------- */
const norm = s => String(s).trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
const cap = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ').replace(/(^|[\s-])([а-яёa-z])/g, (m, a, b) => a + b.toUpperCase());
const PATR_EX = { 'павел': 'Павлович', 'лев': 'Львович', 'петр': 'Петрович', 'михаил': 'Михайлович', 'яков': 'Яковлевич',
  'илья': 'Ильич', 'никита': 'Никитич', 'лука': 'Лукич', 'фома': 'Фомич', 'кузьма': 'Кузьмич',
  'дмитрий': 'Дмитриевич', 'георгий': 'Георгиевич' };
function patronymic(name) {
  const n = cap(name); if (!n) return '';
  const k = norm(n);
  if (PATR_EX[k]) return PATR_EX[k];
  if (/ий$/.test(k)) return n.slice(0, -2) + 'ьевич';
  if (/[йь]$/.test(k)) return n.slice(0, -1) + 'евич';
  if (/[ая]$/.test(k)) return n.slice(0, -1) + 'ич';
  if (/[жшчщц]$/.test(k)) return n + 'евич';
  return n + 'ович';
}
const PATR_F = { 'ильич': 'Ильинична', 'лукич': 'Лукинична', 'фомич': 'Фоминична', 'кузьмич': 'Кузьминична' };
function femPatr(p) {
  const k = norm(p);
  if (PATR_F[k]) return PATR_F[k];
  if (/ович$/.test(k)) return p.slice(0, -4) + 'овна';
  if (/евич$/.test(k)) return p.slice(0, -4) + 'евна';
  if (/ич$/.test(k)) return p.slice(0, -2) + 'ична';
  return p;
}
function femSurname(s) {
  const k = norm(s);
  if (/(ов|ев|ин|ын)$/.test(k)) return s + 'а';
  if (/(ский|цкий)$/.test(k)) return s.slice(0, -2) + 'ая';
  if (/(ой|ый)$/.test(k)) return s.slice(0, -2) + 'ая';
  return s;
}

/* ---------- общее состояние пары и действия над ним ---------- */
const SETS = { r: 'Привычные русские', o: 'Редкие и старинные', i: 'Международные', e: 'Восточные и кавказские' };
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
/* Случайный порядок, в котором наборы идут вперемешку равномерно, без длинных серий из одного набора */
function mix(g, custom) {
  const groups = {}, keyed = [];
  BASE[g].forEach(e => (groups[e.s] = groups[e.s] || []).push(e.n));
  if (custom && custom.length) groups.c = custom.map(e => e.n);
  for (const s in groups) shuffle(groups[s]).forEach((n, i, a) => keyed.push([(i + Math.random()) / a.length, n]));
  return keyed.sort((x, y) => x[0] - y[0]).map(x => x[1]);
}
function mk(g) { return { custom: [], votes: [{}, {}], order: [mix(g), mix(g)], hist: [[], []], r2: null, finals: null }; }
function fresh() {
  return { profile: { surname: 'Иванов', dad: 'Андрей', patr: 'Андреевич', mom: 'Окси', example: true },
    g: 'boy', sets: { r: 1, o: 1, i: 1, e: 1 }, d: { boy: mk('boy'), girl: mk('girl') } };
}
function migrate(S) {
  if (!S.sets) S.sets = { r: 1, o: 1, i: 1, e: 1 };
  if (S.sets.e === undefined) S.sets.e = 1;
  for (const g in BASE) {
    const D = S.d[g], names = BASE[g].map(e => e.n).concat((D.custom || []).map(e => { e.c = 1; return e.n; }));
    D.order.forEach((o, p) => { const has = new Set(o), add = shuffle(names.filter(n => !has.has(n))); if (add.length) D.order[p] = o.concat(add); });
  }
  return S;
}
const all = (S, g) => BASE[g].concat(S.d[g].custom);
const entry = (S, g, n) => all(S, g).find(e => e.n === n);
function r2q(S, p) {
  const r = S.d[S.g].r2; if (!r) return null;
  const q = r.order[p].filter(n => !(n in r.votes[p]));
  return q.length ? q : null;
}
function queue(S, p) {
  const rq = r2q(S, p); if (rq) return rq;
  const D = S.d[S.g], v = D.votes[p], names = all(S, S.g).filter(e => !e.s || S.sets[e.s]).map(e => e.n), set = new Set(names);
  const ord = D.order[p].filter(n => set.has(n)), seen = new Set(ord);
  names.forEach(n => { if (!seen.has(n)) ord.push(n); });
  return ord.filter(n => !(n in v));
}
const matches = (S, g) => all(S, g).filter(e => S.d[g].votes[0][e.n] === 1 && S.d[g].votes[1][e.n] === 1);
function findDup(S, g, input) {
  const x = norm(input);
  for (const e of all(S, g)) if (norm(e.n) === x) return { e, via: null };
  for (const e of all(S, g)) for (const f of e.f) if (norm(f) === x) return { e, via: f };
  return null;
}
/* Единственное место, где меняется состояние. p: 0 — папа, 1 — мама. */
function apply(S, p, a) {
  const g = a.g === 'girl' ? 'girl' : a.g === 'boy' ? 'boy' : S.g, D = S.d[g], ev = {}, ok = { ok: 1, ev };
  switch (a.t) {
    case 'vote': {
      const n = String(a.n), like = a.like ? 1 : 0;
      if (a.r2) {
        const r = D.r2; if (!r || !r.names.includes(n) || (n in r.votes[p])) return ok;
        r.votes[p][n] = like; r.hist[p].push(n);
        const done = q => r.names.every(x => x in r.votes[q]);
        if (done(0) && done(1)) { D.finals = r.names.filter(x => r.votes[0][x] === 1 && r.votes[1][x] === 1); D.r2 = null; ev.r2done = D.finals.length; }
        else if (done(p)) ev.r2mine = 1;
        return ok;
      }
      if (!entry(S, g, n) || (n in D.votes[p])) return ok;
      D.votes[p][n] = like; D.hist[p].push(n);
      return ok;
    }
    case 'undo': {
      if (a.r2) { const r = D.r2; if (r) { const x = r.hist[p].pop(); if (x) delete r.votes[p][x]; } }
      else { const n = D.hist[p].pop(); if (n) delete D.votes[p][n]; }
      return ok;
    }
    case 'add': {
      const raw = String(a.name == null ? '' : a.name);
      if (!/^\s*[а-яёa-z][а-яёa-z\s-]{1,23}\s*$/i.test(raw)) return { err: 'Введите имя буквами, минимум две.' };
      if (D.custom.length >= 200) return { err: 'Слишком много своих имён.' };
      const n = cap(raw), dup = findDup(S, g, n);
      if (dup) return { err: dup.via ? `Такое имя уже есть в списке: ${dup.via} это ${dup.e.n}.` : 'Такое имя уже есть в списке.' };
      const o = D.order[1 - p];
      D.custom.push({ n, f: [], c: 1 }); D.votes[p][n] = 1; D.order[p].push(n);
      let i = o.findIndex(x => !(x in D.votes[1 - p])); if (i < 0) i = o.length;
      o.splice(i + Math.floor(Math.random() * 4), 0, n);
      ev.added = n; return ok;
    }
    case 'unmatch': { const n = String(a.n); if (entry(S, g, n)) D.votes[p][n] = 0; return ok; }
    case 'r2start': {
      if (D.r2) return ok;
      const ms = matches(S, g).map(x => x.n), fin = (D.finals || []).filter(n => ms.includes(n)), pool = fin.length >= 2 ? fin : ms;
      if (pool.length < 2) return { err: 'Для второго круга нужно минимум два мэтча.' };
      D.r2 = { names: pool, votes: [{}, {}], order: [shuffle(pool), shuffle(pool)], hist: [[], []] };
      ev.r2start = pool.length; return ok;
    }
    case 'r2cancel': D.r2 = null; return ok;
    case 'r2clear': D.finals = null; return ok;
    case 'profile': {
      const f = k => cap(a[k]).slice(0, 30), P = { surname: f('surname'), dad: f('dad'), patr: f('patr'), mom: f('mom'), example: false };
      if (!P.surname || !P.dad || !P.patr || !P.mom) return { err: 'Заполните все четыре поля.' };
      S.profile = P; return ok;
    }
    case 'setg': S.g = a.g === 'girl' ? 'girl' : 'boy'; return ok;
    case 'sets': {
      if (!(a.k in SETS)) return { err: 'Нет такого набора.' };
      if (!a.on && S.sets[a.k] && Object.keys(SETS).filter(k => S.sets[k]).length === 1) return { err: 'Хотя бы один набор должен быть включён' };
      S.sets[a.k] = a.on ? 1 : 0; return ok;
    }
    case 'reset': S.d = { boy: mk('boy'), girl: mk('girl') }; return ok;
    case 'resetme': for (const x in BASE) { const E = S.d[x]; E.votes[p] = {}; E.hist[p] = []; E.order[p] = mix(x, E.custom); } return ok;
  }
  return { err: 'Неизвестное действие.' };
}
return { BASE, SETS, norm, cap, patronymic, femPatr, femSurname, fresh, migrate, all, entry, r2q, queue, matches, findDup, apply };
