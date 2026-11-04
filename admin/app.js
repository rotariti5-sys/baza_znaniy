// Админка базы знаний MusicDream.
// Данные и права живут в Supabase (supabase/schema.sql); без настроек в config.js
// страница работает в демо-режиме на localStorage, чтобы можно было посмотреть интерфейс.
'use strict';

const CFG = window.BAZA_CONFIG || {};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROLE_NAMES = { admin: 'Админ', editor: 'Редактор', none: 'Без доступа', blocked: 'Заблокирован' };

const toEmail = (login) => {
  login = login.trim().toLowerCase();
  return login.includes('@') ? login : `${login}@${CFG.loginDomain}`;
};

function toast(text, kind = 'ok') {
  const t = $('#toast');
  t.textContent = text;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 6000 : 2600);
}

// Сообщения Supabase/Postgres → по-русски, чтобы было понятно, что делать.
function humanError(e) {
  const m = String(e?.message || e || '');
  if (/Invalid login credentials/i.test(m)) return 'Неверный логин или пароль.';
  if (/signups are disabled|provider is disabled/i.test(m)) return 'В Supabase выключен вход по Email: Authentication → Sign In / Providers → Email → включить Enable Email provider (выключить только «Confirm email»).';
  if (/Email not confirmed/i.test(m)) return 'Аккаунт не подтверждён: в Supabase выключите Authentication → Sign In / Providers → Email → «Confirm email».';
  if (/already registered|already been registered/i.test(m)) return 'Такой логин уже занят.';
  if (/email.*invalid|invalid.*email/i.test(m)) return 'Supabase не принял логин как адрес. Попробуйте другой логин или почту.';
  if (/duplicate key.*title/i.test(m)) return 'Статья с таким названием уже есть.';
  if (/duplicate key.*name/i.test(m)) return 'Такой раздел уже есть.';
  if (/row-level security|permission denied/i.test(m)) return 'Недостаточно прав для этого действия.';
  if (/Password should be/i.test(m)) return 'Пароль слишком короткий.';
  if (/admin_set_password/i.test(m)) return 'Смена паролей ещё не включена: выполните supabase/002_passwords.sql в Supabase.';
  if (/rate limit/i.test(m)) return 'Слишком много попыток подряд, подождите минуту.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Нет связи с сервером базы. Проверьте интернет.';
  return m || 'Что-то пошло не так.';
}

// ======================================================================
// Слой данных: Supabase
// ======================================================================
function supabaseApi() {
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
  const ok = ({ data, error }) => { if (error) throw error; return data; };

  return {
    demo: false,
    async session() { return ok(await sb.auth.getSession()).session; },
    async hasAdmin() { return ok(await sb.rpc('has_admin')); },
    async signIn(login, password) { ok(await sb.auth.signInWithPassword({ email: toEmail(login), password })); },
    async signUp(login, password, name) {
      ok(await sb.auth.signUp({ email: toEmail(login), password, options: { data: { login: login.trim(), name: name || login.trim() } } }));
    },
    async signOut() { await sb.auth.signOut(); },
    async me() {
      const user = ok(await sb.auth.getUser()).user;
      return ok(await sb.from('profiles').select('*').eq('id', user.id).single());
    },
    async changePassword(password) { ok(await sb.auth.updateUser({ password })); },

    async sections() { return ok(await sb.from('sections').select('*').order('position').order('id')); },
    async addSection(name, position) { ok(await sb.from('sections').insert({ name, position })); },
    async updateSection(id, patch) { ok(await sb.from('sections').update(patch).eq('id', id)); },
    async deleteSection(id) { ok(await sb.from('sections').delete().eq('id', id)); },

    async articles() {
      return ok(await sb.from('articles').select('id,title,section_id,position,hidden,updated_at,updated_by').order('title'));
    },
    async article(id) { return ok(await sb.from('articles').select('*').eq('id', id).single()); },
    async saveArticle(a) {
      const row = { title: a.title, section_id: a.section_id, position: a.position, hidden: a.hidden, body: a.body };
      if (a.id) return ok(await sb.from('articles').update(row).eq('id', a.id).select().single());
      return ok(await sb.from('articles').insert(row).select().single());
    },
    async deleteArticle(id) { ok(await sb.from('articles').delete().eq('id', id)); },

    async home() { return ok(await sb.from('home').select('*').eq('id', 1).maybeSingle()) || { title: '', body: '' }; },
    async saveHome(h) { ok(await sb.from('home').upsert({ id: 1, title: h.title, body: h.body })); },

    async users() { return ok(await sb.from('profiles').select('*').order('created_at')); },
    async setRole(id, role) { ok(await sb.from('profiles').update({ role }).eq('id', id)); },
    // Новый аккаунт создаётся отдельным клиентом без сохранения сессии, чтобы админ
    // не вылетел из своего входа. Роль выдаётся сразу после создания.
    async createUser({ login, password, name, role }) {
      const tmp = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: 'baza-tmp' },
      });
      const res = ok(await tmp.auth.signUp({ email: toEmail(login), password, options: { data: { login: login.trim(), name: name || login.trim() } } }));
      if (!res.user || (res.user.identities && res.user.identities.length === 0)) throw new Error('already registered');
      await tmp.auth.signOut().catch(() => {});
      ok(await sb.from('profiles').update({ role }).eq('id', res.user.id));
      // запоминаем выданный пароль, чтобы админ мог его посмотреть (supabase/002_passwords.sql)
      await sb.rpc('admin_set_password', { target: res.user.id, new_password: password });
    },
    async issuedPasswords() {
      const { data, error } = await sb.from('issued_passwords').select('*');
      if (error) { if (/issued_passwords/.test(error.message)) return null; throw error; }
      return data;
    },
    async setPassword(id, password) { ok(await sb.rpc('admin_set_password', { target: id, new_password: password })); },
  };
}

// ======================================================================
// Слой данных: демо (localStorage)
// ======================================================================
function demoApi() {
  const KEY = 'baza-demo-v1';
  const seed = () => ({
    me: { id: 'me', login: 'admin', name: 'Админ (демо)', role: 'admin', created_at: new Date().toISOString() },
    users: [],
    sections: ['Общая информация', 'Техническая часть', 'Персонаж', 'Игровой процесс', 'Развлечения', 'События', 'Предметы', 'Игровые покупки', 'Танцы', 'Чат', 'Прочее']
      .map((name, i) => ({ id: i + 1, name, position: i + 1 })),
    articles: [{ id: 1, title: 'Как писать статьи', section_id: 11, position: 1, hidden: true, updated_at: new Date().toISOString(), updated_by: 'me',
      body: 'Пример статьи. Ссылка на другую статью: [[Танцевальные режимы]].\n\n## Оформление\n\n- **Жирный**, *курсив*\n- [[Как писать статьи|ссылка с другим текстом]]' }],
    home: { title: 'Добро пожаловать в базу знаний Dance MMO «MusicDream»', body: '**База знаний** — место, где собрана информация об игре MusicDream.' },
    seq: 100,
    logged: false,
  });
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { db = seed(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  if (!db.users.length) db.users = [db.me];

  return {
    demo: true,
    async session() { return db.logged ? {} : null; },
    async hasAdmin() { return true; },
    async signIn() { db.logged = true; save(); },
    async signUp() { db.logged = true; save(); },
    async signOut() { db.logged = false; save(); },
    async me() { return clone(db.me); },
    async changePassword() {},
    async sections() { return clone(db.sections).sort((a, b) => a.position - b.position); },
    async addSection(name, position) {
      if (db.sections.some((s) => s.name === name)) throw new Error('duplicate key name');
      db.sections.push({ id: ++db.seq, name, position }); save();
    },
    async updateSection(id, patch) { Object.assign(db.sections.find((s) => s.id === id), patch); save(); },
    async deleteSection(id) { db.sections = db.sections.filter((s) => s.id !== id); save(); },
    async articles() { return clone(db.articles).sort((a, b) => a.title.localeCompare(b.title, 'ru')); },
    async article(id) { return clone(db.articles.find((a) => a.id === id)); },
    async saveArticle(a) {
      if (db.articles.some((x) => x.title === a.title && x.id !== a.id)) throw new Error('duplicate key title');
      const row = { ...a, updated_at: new Date().toISOString(), updated_by: 'me' };
      if (a.id) Object.assign(db.articles.find((x) => x.id === a.id), row);
      else { row.id = ++db.seq; db.articles.push(row); }
      save(); return clone(row);
    },
    async deleteArticle(id) { db.articles = db.articles.filter((a) => a.id !== id); save(); },
    async home() { return clone(db.home); },
    async saveHome(h) { db.home = { ...h }; save(); },
    async users() { return clone(db.users); },
    async setRole(id, role) { db.users.find((u) => u.id === id).role = role; save(); },
    async createUser({ login, name, role, password }) {
      if (db.users.some((u) => u.login === login)) throw new Error('already registered');
      const id = 'u' + ++db.seq;
      db.users.push({ id, login, name: name || login, role, created_at: new Date().toISOString() });
      (db.issued ||= {})[id] = { user_id: id, password, set_at: new Date().toISOString() }; save();
    },
    async issuedPasswords() { return Object.values(db.issued || {}); },
    async setPassword(id, password) {
      (db.issued ||= {})[id] = { user_id: id, password, set_at: new Date().toISOString() }; save();
    },
  };
}

const api = CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase ? supabaseApi() : demoApi();

// ======================================================================
// Состояние и навигация
// ======================================================================
const state = { me: null, sections: [], articles: [], users: [], editing: null, dirty: false };
const isAdmin = () => state.me?.role === 'admin';

function go(page, push = true) {
  if (!isAdmin() && page === 'users') page = 'articles';
  if (state.dirty && page !== 'edit' && !confirm('Есть несохранённые правки. Уйти без сохранения?')) return;
  if (page !== 'edit') state.dirty = false;
  $$('.page').forEach((p) => p.classList.toggle('is-active', p.dataset.page === page));
  $$('.navitem').forEach((n) => n.classList.toggle('is-active', n.dataset.page === page || (page === 'edit' && n.dataset.page === 'articles')));
  if (push && page !== 'edit') history.replaceState(null, '', '#' + page);
  ({ articles: renderArticles, sections: renderSections, home: loadHome, users: renderUsers })[page]?.();
  $('.main').scrollTop = 0;
}

window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

// ======================================================================
// Вход
// ======================================================================
function eyeToggles(root = document) {
  $$('[data-eye]', root).forEach((b) => b.addEventListener('click', () => {
    const inp = b.parentElement.querySelector('input');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    b.classList.toggle('is-on', inp.type === 'text');
  }));
}

async function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  let hasAdmin = true;
  try { hasAdmin = await api.hasAdmin(); } catch (e) {
    $('#login-msg').textContent = /has_admin|schema cache/.test(e.message)
      ? 'База ещё не настроена: выполните supabase/schema.sql в SQL Editor.' : humanError(e);
    $('#login-msg').className = 'msg err';
  }
  $('#login-form').hidden = !hasAdmin;
  $('#setup-form').hidden = hasAdmin;
  $('#login-title').textContent = hasAdmin ? 'Вход в базу знаний' : 'Первый запуск';
}

async function enter() {
  try {
    state.me = await api.me();
  } catch (e) {
    toast(humanError(e), 'err');
    await api.signOut();
    return showLogin();
  }
  if (!['admin', 'editor'].includes(state.me.role)) {
    await api.signOut();
    await showLogin();
    const m = $('#login-msg');
    m.textContent = state.me.role === 'blocked' ? 'Аккаунт заблокирован.' : 'Доступ ещё не выдан — попросите админа назначить роль.';
    m.className = 'msg err';
    return;
  }
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#demo-note').hidden = !api.demo;
  $$('[data-admin]').forEach((el) => { el.hidden = !isAdmin(); });
  const name = state.me.name || state.me.login || '?';
  $('#me-name').textContent = name;
  $('#me-role').textContent = ROLE_NAMES[state.me.role];
  $('#me-avatar').textContent = name.trim()[0].toUpperCase();
  await loadCommon();
  go((location.hash || '#articles').slice(1), false);
}

async function loadCommon() {
  [state.sections, state.articles] = await Promise.all([api.sections(), api.articles()]);
  if (isAdmin()) state.users = await api.users().catch(() => []);
  else state.users = await api.users().catch(() => [state.me]);
  const opts = state.sections.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $('#art-filter').innerHTML = `<option value="">Все разделы</option>${opts}<option value="none">Без раздела</option>`;
  $('#ed-section').innerHTML = `<option value="">— без раздела —</option>${opts}`;
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('button[type=submit]');
  btn.disabled = true; $('#login-msg').textContent = '';
  try { await api.signIn(f.login.value, f.password.value); await enter(); }
  catch (err) { $('#login-msg').textContent = humanError(err); $('#login-msg').className = 'msg err'; }
  btn.disabled = false;
});

$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('button[type=submit]');
  btn.disabled = true; $('#login-msg').textContent = '';
  try {
    await api.signUp(f.login.value, f.password.value, f.name.value.trim());
    await api.signIn(f.login.value, f.password.value);
    await enter();
  } catch (err) { $('#login-msg').textContent = humanError(err); $('#login-msg').className = 'msg err'; }
  btn.disabled = false;
});

$('#logout').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (state.dirty && !confirm('Есть несохранённые правки. Выйти без сохранения?')) return;
  state.dirty = false;
  await api.signOut();
  showLogin();
});
$('.profile').addEventListener('click', () => go('me'));
$$('.navitem').forEach((n) => n.addEventListener('click', () => go(n.dataset.page)));
document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) go(g.dataset.goto); });

// ======================================================================
// Статьи
// ======================================================================
const secName = (id) => state.sections.find((s) => s.id === id)?.name;
const userName = (id) => { const u = state.users.find((x) => x.id === id); return u ? (u.name || u.login) : ''; };
const fmtDate = (s) => s ? new Date(s).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

function renderArticles() {
  const q = $('#art-search').value.trim().toLowerCase();
  const f = $('#art-filter').value;
  const list = state.articles.filter((a) =>
    (!q || a.title.toLowerCase().includes(q)) &&
    (!f || (f === 'none' ? !a.section_id : String(a.section_id) === f)));
  $('#art-count').textContent = state.articles.length;

  const groups = [...state.sections.map((s) => ({ id: s.id, name: s.name })), { id: null, name: 'Без раздела' }]
    .map((g) => ({ ...g, items: list.filter((a) => (a.section_id ?? null) === g.id) }))
    .filter((g) => g.items.length);
  groups.forEach((g) => g.items.sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.title.localeCompare(b.title, 'ru')));

  $('#art-list').innerHTML = groups.length ? groups.map((g) => `
    <div class="group">
      <div class="section__head"><span class="section__title">${esc(g.name)}</span><span class="hint">${g.items.length}</span></div>
      <div class="list">${g.items.map((a) => `
        <div class="item item--link" data-id="${a.id}">
          <div class="item__main">
            <span class="item__title">${esc(a.title)}</span>
            <span class="item__sub">${a.updated_at ? 'изменено ' + fmtDate(a.updated_at) : ''}${userName(a.updated_by) ? ' · ' + esc(userName(a.updated_by)) : ''}</span>
          </div>
          <div class="item__side">${a.hidden ? '<span class="chip chip--draft">Черновик</span>' : ''}</div>
        </div>`).join('')}
      </div>
    </div>`).join('')
    : `<div class="list"><div class="empty">${state.articles.length ? 'Ничего не найдено.' : 'Статей пока нет — нажмите «Новая статья».'}</div></div>`;
}
$('#art-search').addEventListener('input', renderArticles);
$('#art-filter').addEventListener('change', renderArticles);
$('#art-list').addEventListener('click', (e) => { const it = e.target.closest('[data-id]'); if (it) openEditor(Number(it.dataset.id)); });
$('#art-new').addEventListener('click', () => openEditor(null));

async function openEditor(id) {
  let a = { id: null, title: '', section_id: Number($('#art-filter').value) || null, position: null, hidden: false, body: '' };
  if (id) { try { a = await api.article(id); } catch (e) { return toast(humanError(e), 'err'); } }
  state.editing = a;
  $('#ed-title').value = a.title;
  $('#ed-section').value = a.section_id ?? '';
  $('#ed-position').value = a.position ?? '';
  $('#ed-hidden').checked = a.hidden;
  $('#ed-body').value = a.body;
  $('#ed-delete').hidden = !id;
  $('#ed-meta').textContent = id ? `Последняя правка: ${fmtDate(a.updated_at)}${userName(a.updated_by) ? ', ' + userName(a.updated_by) : ''}` : 'Новая статья';
  setTab('write');
  go('edit');
  state.dirty = false;
  if (!id) $('#ed-title').focus();
}

['#ed-title', '#ed-section', '#ed-position', '#ed-hidden', '#ed-body'].forEach((s) =>
  $(s).addEventListener('input', () => { state.dirty = true; }));

$('#ed-save').addEventListener('click', saveArticle);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && $('.page[data-page=edit]').classList.contains('is-active')) {
    e.preventDefault(); saveArticle();
  }
});

async function saveArticle() {
  const title = $('#ed-title').value.trim().replace(/\s+/g, ' ');
  if (!title) { $('#ed-title').focus(); return toast('Нужно название статьи.', 'err'); }
  if (/[\[\]|]/.test(title)) return toast('В названии нельзя использовать [ ] и |.', 'err');
  const pos = $('#ed-position').value;
  const a = { id: state.editing.id, title, section_id: Number($('#ed-section').value) || null,
    position: pos === '' ? null : Number(pos), hidden: $('#ed-hidden').checked, body: $('#ed-body').value };
  const btn = $('#ed-save'); btn.disabled = true;
  try {
    const saved = await api.saveArticle(a);
    state.editing = { ...a, ...saved };
    state.dirty = false;
    state.articles = await api.articles();
    $('#ed-delete').hidden = false;
    $('#ed-meta').textContent = `Сохранено ${fmtDate(saved.updated_at || new Date().toISOString())}`;
    toast('Статья сохранена.');
  } catch (e) { toast(humanError(e), 'err'); }
  btn.disabled = false;
}

$('#ed-delete').addEventListener('click', async () => {
  if (!state.editing?.id || !confirm(`Удалить статью «${state.editing.title}»? Это нельзя отменить.`)) return;
  try {
    await api.deleteArticle(state.editing.id);
    state.dirty = false;
    state.articles = await api.articles();
    toast('Статья удалена.');
    go('articles');
  } catch (e) { toast(humanError(e), 'err'); }
});

// вкладки «Текст / Просмотр»
function setTab(tab) {
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === tab));
  $('.tabs').classList.toggle('is-preview', tab === 'preview');
  $('#ed-body').hidden = tab !== 'write';
  $('#ed-preview').hidden = tab !== 'preview';
  if (tab === 'preview') $('#ed-preview').innerHTML = renderMd($('#ed-body').value) || '<p class="hint">Текста пока нет.</p>';
}
$$('.tab').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));

// [[Статья]] и [[Статья|текст]] → ссылки; несуществующие статьи подсвечены красным.
function renderMd(src) {
  const titles = new Set(state.articles.map((a) => a.title.toLowerCase()));
  const withLinks = src.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, label) => {
    const title = t.trim();
    const cls = titles.has(title.toLowerCase()) ? 'wl' : 'wl wl-missing';
    return `<a class="${cls}" title="${esc(title)}">${esc((label || title).trim())}</a>`;
  });
  const html = window.marked ? window.marked.parse(withLinks, { breaks: true }) : esc(withLinks);
  return window.DOMPurify ? window.DOMPurify.sanitize(html) : esc(src);
}

// кнопки разметки: «|» в шаблоне — куда встаёт выделенный текст
$('#mdbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-md]'); if (!b) return;
  const ta = $('#ed-body');
  const [pre, post] = b.dataset.md.replace(/\\n/g, '\n').split('|');
  const s = ta.selectionStart, en = ta.selectionEnd, sel = ta.value.slice(s, en);
  const before = ta.value.slice(0, s);
  const lead = pre.startsWith('\n') && (s === 0 || before.endsWith('\n')) ? pre.slice(1) : pre;
  ta.setRangeText(lead + sel + post, s, en, 'end');
  if (!sel) { const c = s + lead.length; ta.setSelectionRange(c, c); }
  ta.focus();
  state.dirty = true;
});

// ======================================================================
// Разделы
// ======================================================================
function renderSections() {
  const cnt = (id) => state.articles.filter((a) => a.section_id === id).length;
  $('#sec-list').innerHTML = state.sections.length ? state.sections.map((s, i) => `
    <div class="item" data-id="${s.id}">
      <span class="item__num">${i + 1}</span>
      <input class="input" value="${esc(s.name)}" data-rename>
      <div class="item__side">
        <span class="hint" style="width:70px;text-align:right">${cnt(s.id)} стат.</span>
        <button class="iconbtn" data-move="-1" title="Выше" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="iconbtn" data-move="1" title="Ниже" ${i === state.sections.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="iconbtn" data-del title="${cnt(s.id) ? 'В разделе есть статьи' : 'Удалить'}" ${cnt(s.id) ? 'disabled' : ''}>✕</button>
      </div>
    </div>`).join('') : '<div class="empty">Разделов нет.</div>';
}

async function reloadSections() { await loadCommon(); renderSections(); }

$('#sec-list').addEventListener('change', async (e) => {
  if (!e.target.matches('[data-rename]')) return;
  const id = Number(e.target.closest('[data-id]').dataset.id), name = e.target.value.trim();
  if (!name) return renderSections();
  try { await api.updateSection(id, { name }); toast('Раздел переименован.'); await reloadSections(); }
  catch (err) { toast(humanError(err), 'err'); renderSections(); }
});

$('#sec-list').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-id]'); if (!row) return;
  const id = Number(row.dataset.id), i = state.sections.findIndex((s) => s.id === id);
  try {
    if (e.target.closest('[data-move]')) {
      const j = i + Number(e.target.closest('[data-move]').dataset.move);
      const list = [...state.sections];
      [list[i], list[j]] = [list[j], list[i]];
      await Promise.all(list.map((s, k) => s.position === k + 1 ? null : api.updateSection(s.id, { position: k + 1 })));
      await reloadSections();
    } else if (e.target.closest('[data-del]')) {
      if (!confirm(`Удалить раздел «${state.sections[i].name}»?`)) return;
      await api.deleteSection(id); toast('Раздел удалён.'); await reloadSections();
    }
  } catch (err) { toast(humanError(err), 'err'); }
});

$('#sec-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = e.target.name.value.trim(); if (!name) return;
  try {
    await api.addSection(name, (state.sections.at(-1)?.position || 0) + 1);
    e.target.reset(); toast('Раздел добавлен.'); await reloadSections();
  } catch (err) { toast(humanError(err), 'err'); }
});

// ======================================================================
// Заглавная
// ======================================================================
async function loadHome() {
  try { const h = await api.home(); $('#home-title').value = h.title; $('#home-body').value = h.body; }
  catch (e) { toast(humanError(e), 'err'); }
}
$('#home-save').addEventListener('click', async () => {
  try { await api.saveHome({ title: $('#home-title').value.trim(), body: $('#home-body').value }); toast('Заглавная сохранена.'); }
  catch (e) { toast(humanError(e), 'err'); }
});

// ======================================================================
// Пользователи (админ)
// ======================================================================
async function renderUsers() {
  let issued;
  try { [state.users, issued] = await Promise.all([api.users(), api.issuedPasswords()]); }
  catch (e) { return toast(humanError(e), 'err'); }
  const pw = new Map((issued || []).map((p) => [p.user_id, p]));
  const open = new Set($$('.urow.is-open').map((r) => r.dataset.id));

  $('#user-list').innerHTML = state.users.map((u) => {
    const self = u.id === state.me.id;
    const name = u.name || u.login || '?';
    const p = pw.get(u.id);
    const current = issued === null
      ? '<span class="hint">Чтобы видеть пароли, выполните supabase/002_passwords.sql в Supabase.</span>'
      : p ? `<span class="pw" data-pw="${esc(p.password)}">••••••••••</span>
             <button class="linkbtn" data-show type="button">Показать</button>
             <button class="linkbtn" data-copy type="button">Копировать</button>
             <span class="hint">выдан ${fmtDate(p.set_at)}</span>`
        : '<span class="hint">Не сохранён: задан до этой функции или сменён самим пользователем. Задайте новый ниже.</span>';
    return `
    <div class="urow${open.has(u.id) ? ' is-open' : ''}" data-id="${u.id}">
      <div class="item">
        <div class="avatar">${esc(name.trim()[0].toUpperCase())}</div>
        <div class="item__main">
          <span class="item__title">${esc(name)}${self ? ' <span class="hint">(вы)</span>' : ''}</span>
          <span class="item__sub">логин: ${esc(u.login || '—')} · с ${fmtDate(u.created_at)}</span>
        </div>
        <div class="item__side">
          ${self ? `<span class="chip chip--${u.role}">${ROLE_NAMES[u.role]}</span>
            <button class="btn btn--surface btn--sm" data-goto="me" type="button"><span class="btn__content">Мой пароль</span></button>` : `
          <button class="btn btn--surface btn--sm" data-pwtoggle type="button"><span class="btn__content">Пароль</span></button>
          <select class="input" data-role style="width:160px">
            ${Object.entries(ROLE_NAMES).map(([k, v]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${v}</option>`).join('')}
          </select>`}
        </div>
      </div>
      ${self ? '' : `
      <div class="pwbox">
        <div class="pwbox__cur"><span class="gfield__label">Текущий пароль</span>${current}</div>
        <form class="pwbox__set" data-setpw>
          <span class="gfield__wrap grow">
            <input class="input" name="password" minlength="8" required placeholder="Новый пароль (от 8 символов)" autocomplete="off">
            <button type="button" class="gfield__eye is-text" data-gen title="Придумать пароль">⟳</button>
          </span>
          <button class="btn btn--primary btn--sm" type="submit"><span class="btn__content">Сменить пароль</span></button>
        </form>
      </div>`}
    </div>`;
  }).join('');
}

$('#user-list').addEventListener('click', async (e) => {
  const row = e.target.closest('.urow'); if (!row) return;
  if (e.target.closest('[data-pwtoggle]')) row.classList.toggle('is-open');
  const pwEl = row.querySelector('[data-pw]');
  if (e.target.closest('[data-show]')) {
    const shown = pwEl.textContent === pwEl.dataset.pw;
    pwEl.textContent = shown ? '••••••••••' : pwEl.dataset.pw;
    e.target.closest('[data-show]').textContent = shown ? 'Показать' : 'Скрыть';
  }
  if (e.target.closest('[data-copy]')) {
    try { await navigator.clipboard.writeText(pwEl.dataset.pw); toast('Пароль скопирован.'); }
    catch { toast('Не удалось скопировать — нажмите «Показать» и выделите вручную.', 'err'); }
  }
  if (e.target.closest('[data-gen]')) row.querySelector('[data-setpw]').password.value = genPassword();
});

$('#user-list').addEventListener('submit', async (e) => {
  if (!e.target.matches('[data-setpw]')) return;
  e.preventDefault();
  const row = e.target.closest('.urow'), id = row.dataset.id;
  const u = state.users.find((x) => x.id === id);
  const password = e.target.password.value;
  const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
  try {
    await api.setPassword(id, password);
    toast(`Пароль для «${u.login}» изменён. Старые входы этого аккаунта сброшены.`);
    await renderUsers();
  } catch (err) { toast(humanError(err), 'err'); }
  btn.disabled = false;
});

$('#user-list').addEventListener('change', async (e) => {
  if (!e.target.matches('[data-role]')) return;
  const id = e.target.closest('[data-id]').dataset.id;
  try { await api.setRole(id, e.target.value); toast('Роль изменена.'); }
  catch (err) { toast(humanError(err), 'err'); }
  renderUsers();
});

function genPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint32Array(12));
  return [...r].map((x) => abc[x % abc.length]).join('');
}
$('#gen-pass').addEventListener('click', () => { $('#user-add').password.value = genPassword(); });

$('#user-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('button[type=submit]');
  const data = { login: f.login.value.trim(), password: f.password.value, name: f.name.value.trim(), role: f.role.value };
  btn.disabled = true;
  try {
    await api.createUser(data);
    toast(`Аккаунт «${data.login}» создан. Передайте логин и пароль.`);
    f.reset();
    renderUsers();
  } catch (err) { toast(humanError(err), 'err'); }
  btn.disabled = false;
});

// ======================================================================
// Мой аккаунт
// ======================================================================
$('#me-pass').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api.changePassword(e.target.password.value); e.target.reset(); toast('Пароль изменён.'); }
  catch (err) { toast(humanError(err), 'err'); }
});

// ======================================================================
// Старт
// ======================================================================
eyeToggles();
(async () => {
  try { (await api.session()) ? await enter() : await showLogin(); }
  catch (e) { await showLogin(); }
})();
