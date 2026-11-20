// ---------- Справочники для отображения ----------
const STATUS_NAMES = {
  new: 'Новая', clarify: 'На уточнении', work: 'В работе', done: 'БТ готово', rejected: 'Отклонена'
};
const KIND_NAMES = { new: 'Новый функционал', improve: 'Доработка', bug: 'Баг' };
const SEVERITY_NAMES = {
  blocker: 'Блокирует работу', major: 'Мешает, есть обходной путь', minor: 'Незначительная'
};
const PERIOD_NAMES = { day: 'в день', week: 'в неделю', month: 'в месяц', year: 'в год' };

const esc = escapeHtml;
const text = (s) => (s ? esc(String(s)).replace(/\n/g, '<br>') : '—');
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '—');

// ---------- Роль, пользователь, запросы к API ----------
let role = localStorage.getItem('role') || 'employee';
let user = localStorage.getItem('user') || 'user1';
let currentTab = 'new';
let newCount = 0;
let myCache = [];
let allCache = [];
let statusFilter = 'all';

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Role': role, 'X-User': user },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `ошибка сервера (${res.status})`);
  return data;
}

// ---------- Мелкие помощники для списков ----------
function kindLabel(r) {
  const sev = r.kind === 'bug' && r.bug ? SEVERITY_NAMES[r.bug.severity] : '';
  return (KIND_NAMES[r.kind] || '') + (sev ? ` (${sev})` : '');
}

function hoursLabel(r) {
  if (r.kind === 'bug' || !r.freq || !r.roleTimes) return '—';
  const c = calcFrom(r.freq, r.roleTimes);
  return c ? c.hoursMonth.toFixed(1) : '—';
}

const canEdit = (r) => r.status === 'new' || r.status === 'clarify';

// ---------- Навигация ----------
function renderNav() {
  const tabs = role === 'analyst'
    ? [['all', 'Все заявки' + (newCount ? ` (новых: ${newCount})` : '')]]
    : [['new', 'Новая заявка'], ['my', 'Мои заявки']];
  const active = currentTab === 'card' ? 'all' : currentTab;
  $('#nav').innerHTML = tabs
    .map(([id, label]) =>
      `<button type="button" data-view="${id}" class="${id === active ? 'active' : ''}">${label}</button>`)
    .join('');
}

function showView(name, flash) {
  if (name !== 'new' && editingId !== null) leaveEditMode();
  ['new', 'my', 'all', 'card'].forEach((v) => { $('#view-' + v).hidden = v !== name; });
  currentTab = name;
  renderNav();
  if (name === 'my') renderMy(flash);
  if (name === 'all') renderAll();
}

$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  if (b.dataset.view === 'new' && editingId !== null) leaveEditMode();
  showView(b.dataset.view);
});

// ---------- Мои заявки (сотрудник) ----------
async function renderMy(flash) {
  const box = $('#view-my');
  box.innerHTML = '<p>Загрузка…</p>';
  try {
    myCache = await api('GET', '/api/requests');
  } catch (err) {
    box.innerHTML = `<p class="err">Не удалось загрузить: ${esc(err.message)}</p>`;
    return;
  }
  const rows = myCache.map((r) => `
    <tr>
      <td>${esc(r.title)}</td>
      <td>${kindLabel(r)}</td>
      <td>${fmtDate(r.createdAt)}</td>
      <td>${hoursLabel(r)}</td>
      <td>${STATUS_NAMES[r.status]}</td>
      <td>${text(r.analystNote)}</td>
      <td>${canEdit(r)
        ? `<button type="button" class="edit-btn" data-id="${esc(r.id)}">${r.status === 'clarify' ? 'Дополнить заявку' : 'Изменить заявку'}</button>`
        : ''}</td>
    </tr>`).join('');
  box.innerHTML = `
    <h2>Мои заявки</h2>
    ${flash ? `<p id="flash">${esc(flash)}</p>` : ''}
    ${myCache.length
      ? `<table>
          <tr><th>Название</th><th>Тип</th><th>Отправлена</th><th>Оценка, ч/мес</th><th>Статус</th><th>Комментарий аналитика</th><th></th></tr>
          ${rows}
        </table>`
      : '<p>Заявок пока нет.</p>'}`;
}

$('#view-my').addEventListener('click', (e) => {
  const b = e.target.closest('.edit-btn');
  if (!b) return;
  const r = myCache.find((x) => x.id === b.dataset.id);
  if (r) startEdit(r);
});

// ---------- Правка своей заявки: переиспользуем форму ----------
function getDeep(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setRows(steps, roleTimes) {
  $('#stepsTable tbody').innerHTML = '';
  $('#roleTimesTable tbody').innerHTML = '';
  (steps && steps.length ? steps : [{}, {}]).forEach((s) => {
    const row = addRow('stepRowTpl', '#stepsTable tbody');
    row.querySelector('.step-who').value = s.who || '';
    row.querySelector('.step-what').value = s.what || '';
    if (s.where) row.querySelector('.step-where').value = s.where;
  });
  (roleTimes && roleTimes.length ? roleTimes : [{}]).forEach((r) => {
    const row = addRow('roleRowTpl', '#roleTimesTable tbody');
    row.querySelector('.role-name').value = r.role || '';
    row.querySelector('.role-min').value = r.min || '';
  });
}

function fillForm(data) {
  resetForm();
  form.querySelectorAll('input[name], select[name], textarea[name]').forEach((el) => {
    const v = getDeep(data, el.name);
    if (el.type === 'checkbox') {
      el.checked = Array.isArray(v) && v.includes(el.value);
    } else if (v !== undefined && v !== null) {
      el.value = v;
    }
  });
  setRows(data.steps, data.roleTimes);
  update();
}

function startEdit(r) {
  editingId = r.id;               // сначала режим правки, чтобы не затереть черновик
  fillForm(r);
  $('#editBanner').textContent = `Редактирование заявки «${r.title}»`;
  $('#editBanner').hidden = false;
  $('#cancelEdit').hidden = false;
  form.querySelector('button[type=submit]').textContent = 'Сохранить и отправить повторно';
  showView('new');
}

function leaveEditMode() {
  editingId = null;
  $('#editBanner').hidden = true;
  $('#cancelEdit').hidden = true;
  form.querySelector('button[type=submit]').textContent = 'Отправить заявку';
  if (!loadDraft()) resetForm();  // вернуть черновик новой заявки, если он был
  update();
}

$('#cancelEdit').addEventListener('click', () => {
  leaveEditMode();
  showView('my');
});

// ---------- Все заявки (аналитик) ----------
async function renderAll() {
  const box = $('#view-all');
  box.innerHTML = '<p>Загрузка…</p>';
  try {
    allCache = await api('GET', '/api/requests');
  } catch (err) {
    box.innerHTML = `<p class="err">Не удалось загрузить: ${esc(err.message)}</p>`;
    return;
  }
  newCount = allCache.filter((r) => r.status === 'new').length;
  renderNav();
  drawAll();
}

function drawAll() {
  const count = (s) => allCache.filter((r) => r.status === s).length;
  const filters = [['all', `Все (${allCache.length})`]]
    .concat(Object.keys(STATUS_NAMES).map((s) => [s, `${STATUS_NAMES[s]} (${count(s)})`]))
    .map(([k, label]) =>
      `<button type="button" data-filter="${k}" class="${k === statusFilter ? 'active' : ''}">${label}</button>`)
    .join('');
  const list = statusFilter === 'all' ? allCache : allCache.filter((r) => r.status === statusFilter);
  const rows = list.map((r) => `
    <tr>
      <td>${esc(r.title)}</td>
      <td>${kindLabel(r)}</td>
      <td>${esc(r.contact ? r.contact.dept : '')}</td>
      <td>${esc(r.author)}</td>
      <td>${fmtDate(r.createdAt)}</td>
      <td>${hoursLabel(r)}</td>
      <td>${STATUS_NAMES[r.status]}</td>
      <td><button type="button" class="open-btn" data-id="${esc(r.id)}">Открыть</button></td>
    </tr>`).join('');
  $('#view-all').innerHTML = `
    <h2>Все заявки</h2>
    <div class="filters">${filters}</div>
    ${list.length
      ? `<table>
          <tr><th>Название</th><th>Тип</th><th>Подразделение</th><th>Автор</th><th>Дата</th><th>Оценка, ч/мес</th><th>Статус</th><th></th></tr>
          ${rows}
        </table>`
      : '<p>Нет заявок.</p>'}`;
}

$('#view-all').addEventListener('click', async (e) => {
  const f = e.target.closest('[data-filter]');
  if (f) {
    statusFilter = f.dataset.filter;
    drawAll();
    return;
  }
  const b = e.target.closest('.open-btn');
  if (b) {
    try {
      showCard(await api('GET', `/api/requests/${b.dataset.id}`));
    } catch (err) {
      alert(err.message);
    }
  }
});

// ---------- Карточка заявки (аналитик) ----------
function cardHtml(r) {
  const list = (a) => (a && a.length ? a.map((x) => esc(x)).join(', ') : '—');
  const c = r.contact || {};
  let html = `
    <h2>${esc(r.title)}</h2>
    <p>Тип: ${kindLabel(r)}${r.kindModule ? `, модуль: ${esc(r.kindModule)}` : ''}<br>
    Контакт: ${esc(c.name)}, ${esc(c.dept)}, ${esc(c.phone)}<br>
    Автор: ${esc(r.author)}. Отправлена: ${fmtDate(r.createdAt)}. Изменена автором: ${fmtDate(r.updatedAt)}</p>`;

  if (r.kind === 'bug') {
    const b = r.bug || {};
    html += `
      <h3>Описание ошибки</h3>
      <p>Где возникает: ${text(b.where)}</p>
      <p>Шаги воспроизведения: ${text(b.steps)}</p>
      <p>Ожидалось: ${text(b.expected)}</p>
      <p>Произошло: ${text(b.actual)}</p>
      <p>Когда: ${esc(b.when || '—')}</p>
      <p>Критичность: ${SEVERITY_NAMES[b.severity] || '—'}</p>
      <p>Затронуто: ${text(b.affected)}</p>
      <p>Ссылки: ${text(b.links)}</p>`;
  } else {
    const steps = (r.steps || [])
      .map((s) => `<tr><td>${esc(s.who)}</td><td>${text(s.what)}</td><td>${esc(s.where)}</td></tr>`)
      .join('');
    const calcRes = calcFrom(r.freq || {}, r.roleTimes || []);
    const roleRows = calcRes
      ? calcRes.byRole.map((x) =>
          `<tr><td>${esc(x.role)}</td><td>${x.min}</td><td>${x.hours.toFixed(1)}</td></tr>`).join('') +
        `<tr><th>Итого</th><th>${calcRes.totalMin}</th><th>${calcRes.hoursMonth.toFixed(1)}</th></tr>`
      : '<tr><td colspan="3">Нет данных для расчёта</td></tr>';
    const p = r.problems || {};
    const o = r.opt || {};
    const w = r.wait || {};
    html += `
      <h3>Как процесс идёт сейчас</h3>
      <table><tr><th>Кто</th><th>Что делает</th><th>Где</th></tr>${steps}</table>
      <p>Участники: ${list(r.participants)}${r.otherPart ? ', ' + esc(r.otherPart) : ''}</p>
      <p>Системы: ${list(r.systems)}${r.otherSys ? ', ' + esc(r.otherSys) : ''}</p>

      <h3>Объём и время</h3>
      <p>Частота: ${r.freq ? esc(r.freq.n) + ' ' + (PERIOD_NAMES[r.freq.period] || '') : '—'}</p>
      <table><tr><th>Участник</th><th>Минут на операцию</th><th>Часов в месяц</th></tr>${roleRows}</table>
      ${calcRes ? `<p>Оценка: ${calcRes.hoursMonth.toFixed(1)} ч в месяц, ${calcRes.hoursYear.toFixed(1)} ч в год</p>` : ''}
      <p>Ожидание: ${esc(w.min != null ? w.min : '—')} мин (${esc(w.who || '')})</p>

      <h3>Проблемы и документы</h3>
      <p>Типы проблем: ${list(p.types)}</p>
      <p>Пример: ${text(p.example)}</p>
      <p>Проводки, документы, отчёты: ${text(r.documents)}</p>

      <h3>Каким процесс должен стать</h3>
      <p>После автоматизации: ${text(r.tobe)}</p>
      <p>Правила и расчёты: ${text(r.rules)}</p>
      <p>Ссылка на инструкцию: ${text(r.rulesLink)}</p>

      <h3>Дополнительно</h3>
      <p>Клиент: ${text(o.client)}</p>
      <p>Доход или объём: ${text(o.income)}</p>
      <p>Потери: ${text(o.losses)}</p>
      <p>Как поймём, что стало лучше: ${text(o.target)}</p>
      <p>Срок или регулятор: ${text(o.deadline)}</p>
      <p>Ссылки: ${text(o.links)}</p>`;
  }

  const options = Object.keys(STATUS_NAMES)
    .map((s) => `<option value="${s}"${s === r.status ? ' selected' : ''}>${STATUS_NAMES[s]}</option>`)
    .join('');
  html += `
    <h3>Решение аналитика</h3>
    <p><select id="cardStatus">${options}</select></p>
    <p><textarea id="cardNote" rows="3" placeholder="Комментарий автору">${esc(r.analystNote || '')}</textarea></p>
    <button type="button" id="saveStatus" data-id="${esc(r.id)}">Сохранить статус</button>
    <button type="button" id="backToList">← К списку</button>
    <p id="cardMessage"></p>`;
  return html;
}

function showCard(r) {
  $('#view-card').innerHTML = cardHtml(r);
  showView('card');
}

$('#view-card').addEventListener('click', async (e) => {
  if (e.target.id === 'backToList') {
    showView('all');
  }
  if (e.target.id === 'saveStatus') {
    const msg = $('#cardMessage');
    try {
      await api('PATCH', `/api/requests/${e.target.dataset.id}`, {
        status: $('#cardStatus').value,
        analystNote: $('#cardNote').value
      });
      msg.textContent = 'Статус сохранён';
      msg.className = 'ok';
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'err';
    }
  }
});

// ---------- Переключатель роли и пользователя ----------
function startView() {
  showView(role === 'analyst' ? 'all' : 'new');
}

$('#roleSelect').value = role;
$('#userInput').value = user;

$('#roleSelect').addEventListener('change', () => {
  role = $('#roleSelect').value;
  localStorage.setItem('role', role);
  if (editingId !== null) leaveEditMode();
  startView();
});

$('#userInput').addEventListener('change', () => {
  // В заголовок HTTP нельзя положить кириллицу, поэтому оставляем латиницу, цифры и "-" / "_"
  user = $('#userInput').value.trim().replace(/[^\w-]/g, '') || 'user1';
  $('#userInput').value = user;
  localStorage.setItem('user', user);
  if (editingId !== null) leaveEditMode();
  startView();
});

startView();