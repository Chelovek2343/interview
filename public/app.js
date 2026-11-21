const form = document.getElementById('requestForm');
const $ = (sel) => document.querySelector(sel);
let editingId = null; // id заявки, которую сейчас правит автор (null: создаём новую)

// Значения по умолчанию из ТЗ, п. 6: множитель "операций в месяц"
const PERIOD_MULT = { day: 21, week: 4.33, month: 1, year: 1 / 12 };

// ---------- Вспомогательные функции ----------
const val = (name) => form.elements[name].value.trim();
const anyChecked = (name) =>
    form.querySelectorAll(`[name="${name}"]:checked`).length > 0;

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(
        /[&<>"']/g,
        (c) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[c],
    );
}

// ---------- Динамические таблицы ----------
function addRow(tplId, tbodySelector) {
    const row = document
        .getElementById(tplId)
        .content.firstElementChild.cloneNode(true);
    $(tbodySelector).appendChild(row);
    return row;
}

function getSteps() {
    return [...document.querySelectorAll('#stepsTable tbody tr')].map((tr) => ({
        who: tr.querySelector('.step-who').value.trim(),
        what: tr.querySelector('.step-what').value.trim(),
        where: tr.querySelector('.step-where').value,
    }));
}

function getRoleTimes() {
    return [...document.querySelectorAll('#roleTimesTable tbody tr')].map(
        (tr) => ({
            role: tr.querySelector('.role-name').value.trim(),
            min: Number(tr.querySelector('.role-min').value),
            kind: tr.querySelector('.role-kind').value,
        }),
    );
}

// ---------- Показ и скрытие по типу задачи ----------
function updateKind() {
    const kind = form.elements['kind'].value;
    $('#processSections').hidden = kind === 'bug';
    $('#bugSection').hidden = kind !== 'bug';
    $('#kindModuleBox').hidden = !(kind === 'improve' || kind === 'bug');
}

// ---------- Расчёт трудозатрат (ТЗ, п. 6) ----------
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const fmt1 = (n) => n.toFixed(1);

// Диапазон в скобках; пустая строка, если нет времени «на единицу»
function rangeSuffix(c, key, f = fmt1) {
    if (!c.hasUnits) return '';
    const [lo, hi] = c.range[key];
    return ` (от ${f(lo)} до ${f(hi)})`;
}

function minCell(c, x) {
    const [lo, hi] = x.minRange;
    return (
        fmt(x.min) + (c.hasUnits && lo !== hi ? ` (${fmt(lo)}–${fmt(hi)})` : '')
    );
}

// Основные поля результата (totalMin, hoursMonth, byRole[].min и т. д.) считаются по СРЕДНЕМУ.
// Диапазон лежит отдельно в range и в minRange.
function calcFrom(freq, roleTimes, units) {
    const n = Number(freq && freq.n);
    const mult = freq ? PERIOD_MULT[freq.period] : undefined;
    if (!(n > 0) || !mult) return null;

    const u = units || {};
    const vals = [Number(u.min) || 0, Number(u.max) || 0].filter((x) => x > 0);
    const lo = vals.length ? Math.min(...vals) : 0;
    const hi = vals.length ? Math.max(...vals) : 0;
    const mid = (lo + hi) / 2;

    // У одного участника может быть две строки: «на операцию» и «на единицу». Складываем по имени.
    const byName = new Map();
    roleTimes
        .filter((r) => r.role && r.min > 0)
        .forEach((r) => {
            const e = byName.get(r.role) || {
                role: r.role,
                fixed: 0,
                perUnit: 0,
            };
            if (r.kind === 'unit') e.perUnit += r.min;
            else e.fixed += r.min;
            byName.set(r.role, e);
        });
    const roles = [...byName.values()].map((e) => ({
        role: e.role,
        perUnit: e.perUnit,
        min: e.fixed + e.perUnit * mid,
        minRange: [e.fixed + e.perUnit * lo, e.fixed + e.perUnit * hi],
    }));

    const sum = (f) => roles.reduce((s, r) => s + f(r), 0);
    const totalMin = sum((r) => r.min);
    if (totalMin === 0) return null;
    const totalLo = sum((r) => r.minRange[0]);
    const totalHi = sum((r) => r.minRange[1]);

    const ops = n * mult;
    const toMonth = (m) => (ops * m) / 60;

    return {
        totalMin,
        hoursMonth: toMonth(totalMin),
        hoursYear: toMonth(totalMin) * 12,
        hasUnits: hi > 0 && roles.some((r) => r.perUnit > 0),
        range: {
            totalMin: [totalLo, totalHi],
            hoursMonth: [toMonth(totalLo), toMonth(totalHi)],
            hoursYear: [toMonth(totalLo) * 12, toMonth(totalHi) * 12],
        },
        byRole: roles.map((r) => ({
            role: r.role,
            min: r.min,
            minRange: r.minRange,
            hours: toMonth(r.min),
            share: r.min / totalMin,
        })),
    };
}

function calc() {
    return calcFrom(
        {
            n: form.elements['freq.n'].value,
            period: form.elements['freq.period'].value,
        },
        getRoleTimes(),
        {
            min: form.elements['unitsMin'].value,
            max: form.elements['unitsMax'].value,
        },
    );
}

function renderCalc() {
    const box = $('#calcResult');
    if (form.elements['kind'].value === 'bug') {
        box.textContent = 'Для бага расчёт не выполняется';
        return;
    }
    const c = calc();
    if (!c) {
        box.textContent = '— Заполните раздел 3 (п. 7 и п. 8)';
        return;
    }
    const COLORS = ['#777', '#aaa', '#555', '#ccc'];
    const bar = c.byRole
        .map(
            (r, i) =>
                `<span style="width:${(r.share * 100).toFixed(1)}%;background:${COLORS[i % COLORS.length]}"></span>`,
        )
        .join('');
    const items = c.byRole
        .map(
            (r) =>
                `<li>${escapeHtml(r.role)}: ${r.hours.toFixed(1)} ч (${Math.round(r.share * 100)}%)</li>`,
        )
        .join('');
    box.innerHTML = `
    <div class="big">${c.hoursMonth.toFixed(1)} ч в месяц</div>
    ${c.hasUnits ? `<div>${rangeSuffix(c, 'hoursMonth').trim()}, по среднему числу единиц</div>` : ''}
    <div class="bar">${bar}</div>
    <div>${c.hoursYear.toFixed(1)} ч в год${rangeSuffix(c, 'hoursYear')}</div>
    <div>${fmt(c.totalMin)} чел-мин на операцию${rangeSuffix(c, 'totalMin', fmt)}</div>
    <ul>${items}</ul>`;
}

// ---------- Обязательные поля (ТЗ, п. 4) ----------
// scope: 'all' - всегда, 'process' - для new/improve, 'bug' - для бага
const RULES = [
    {
        label: '1. Тип задачи',
        scope: 'all',
        target: '#kind',
        ok: () => {
            const kind = val('kind');
            if (!kind) return false;
            return kind === 'new' || val('kindModule') !== '';
        },
    },
    {
        label: '2. Название задачи',
        scope: 'all',
        target: '[name="title"]',
        ok: () => val('title') !== '',
    },
    {
        label: '3. Контактное лицо',
        scope: 'all',
        target: '[name="contact.name"]',
        ok: () =>
            val('contact.name') !== '' &&
            val('contact.dept') !== '' &&
            val('contact.phone') !== '',
    },

    {
        label: '4. Шаги процесса',
        scope: 'process',
        target: '#stepsTable',
        ok: () => getSteps().some((s) => s.who && s.what),
    },
    {
        label: '5. Участники',
        scope: 'process',
        target: '#participants',
        ok: () => anyChecked('participants') || val('otherPart') !== '',
    },
    {
        label: '6. Системы и документы',
        scope: 'process',
        target: '#systems',
        ok: () => anyChecked('systems') || val('otherSys') !== '',
    },
    {
        label: '7. Частота операции',
        scope: 'process',
        target: '[name="freq.n"]',
        ok: () => Number(val('freq.n')) > 0,
    },
    {
        label: '8. Время по участникам',
        scope: 'process',
        target: '#roleTimesTable',
        ok: () => {
            const rows = getRoleTimes().filter((r) => r.role && r.min > 0);
            if (rows.length === 0) return false;
            if (rows.some((r) => r.kind === 'unit')) {
                // есть время «на единицу»: нужен диапазон единиц
                const a = Number(val('unitsMin'));
                const b = Number(val('unitsMax'));
                return a > 0 && b > 0 && a <= b;
            }
            return true;
        },
    },
    {
        label: '9. Ожидание',
        scope: 'process',
        target: '[name="wait.min"]',
        ok: () => val('wait.min') !== '' && Number(val('wait.min')) >= 0,
    },
    {
        label: '10. Проблемы и пример',
        scope: 'process',
        target: '#problemTypes',
        ok: () =>
            anyChecked('problems.types') && val('problems.example') !== '',
    },
    {
        label: '11. Проводки и документы',
        scope: 'process',
        target: '[name="documents"]',
        ok: () => val('documents') !== '',
    },
    {
        label: '12. Как должно быть',
        scope: 'process',
        target: '[name="tobe"]',
        ok: () => val('tobe') !== '',
    },
    {
        label: '13. Правила и расчёты',
        scope: 'process',
        target: '[name="rules"]',
        ok: () => val('rules') !== '',
    },

    {
        label: 'Б1. Где возникает ошибка',
        scope: 'bug',
        target: '[name="bug.where"]',
        ok: () => val('bug.where') !== '',
    },
    {
        label: 'Б2. Шаги воспроизведения',
        scope: 'bug',
        target: '[name="bug.steps"]',
        ok: () => val('bug.steps') !== '',
    },
    {
        label: 'Б3. Что ожидалось',
        scope: 'bug',
        target: '[name="bug.expected"]',
        ok: () => val('bug.expected') !== '',
    },
    {
        label: 'Б4. Что произошло',
        scope: 'bug',
        target: '[name="bug.actual"]',
        ok: () => val('bug.actual') !== '',
    },
    {
        label: 'Б5. Когда произошло',
        scope: 'bug',
        target: '[name="bug.when"]',
        ok: () => val('bug.when') !== '',
    },
    {
        label: 'Б6. Критичность',
        scope: 'bug',
        target: '[name="bug.severity"]',
        ok: () => val('bug.severity') !== '',
    },
];

function activeRules() {
    const scope = form.elements['kind'].value === 'bug' ? 'bug' : 'process';
    return RULES.filter((r) => r.scope === 'all' || r.scope === scope);
}

function renderChecklist() {
    const rules = activeRules();
    const ul = $('#checklist');
    ul.innerHTML = '';
    let done = 0;
    rules.forEach((r) => {
        const ok = r.ok();
        if (ok) done++;
        const li = document.createElement('li');
        li.textContent = (ok ? '✓ ' : '○ ') + r.label;
        li.className = ok ? 'done' : '';
        li.addEventListener('click', () => {
            const el = $(r.target);
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (el.focus) el.focus();
        });
        ul.appendChild(li);
    });
    $('#counter').textContent = `${done} из ${rules.length}`;
}

// ---------- Ошибки валидации ----------
let showErrors = false;

function clearErrors() {
    form.querySelectorAll('.error').forEach((el) =>
        el.classList.remove('error'),
    );
    form.querySelectorAll('.error-text').forEach((el) => el.remove());
}

function validate() {
    clearErrors();
    const failed = activeRules().filter((r) => !r.ok());
    failed.forEach((r) => {
        const el = $(r.target);
        el.classList.add('error');
        const msg = document.createElement('div');
        msg.className = 'error-text';
        msg.textContent = 'Заполните: ' + r.label;
        el.insertAdjacentElement('afterend', msg);
    });
    return failed;
}

function showMessage(text, isError) {
    const m = $('#message');
    m.textContent = text;
    m.className = isError ? 'err' : 'ok';
}

// ---------- Сбор данных в JSON по ТЗ ----------
function setDeep(obj, path, value) {
    const keys = path.split('.');
    let cur = obj;
    keys.slice(0, -1).forEach((k) => {
        cur[k] = cur[k] || {};
        cur = cur[k];
    });
    cur[keys[keys.length - 1]] = value;
}

function collectData() {
    const data = { kindModule: '' };
    form.querySelectorAll('input[name], select[name], textarea[name]').forEach(
        (el) => {
            if (el.type === 'checkbox' || el.closest('[hidden]')) return; // скрытое не отправляем
            let v = el.value.trim();
            if (el.type === 'number') v = v === '' ? null : Number(v);
            setDeep(data, el.name, v);
        },
    );
    if (!$('#processSections').hidden) {
        ['participants', 'systems', 'problems.types'].forEach((name) => {
            const checked = [
                ...form.querySelectorAll(`[name="${name}"]:checked`),
            ].map((c) => c.value);
            setDeep(data, name, checked);
        });
        data.steps = getSteps().filter((s) => s.who || s.what); // п. 7 ТЗ: пустые строки отбрасываем
        data.roleTimes = getRoleTimes().filter((r) => r.role || r.min > 0);
        if (!data.roleTimes.some((r) => r.kind === 'unit')) {
            delete data.unitsName;
            delete data.unitsMin;
            delete data.unitsMax; // единицы нужны, только если есть время «на единицу»
        }
    }
    return data;
}

// ---------- Черновик ----------
const DRAFT_KEY = 'zayavki-draft';

function saveDraft() {
    const draft = {
        fields: {},
        checked: [],
        steps: getSteps(),
        roleTimes: getRoleTimes(),
    };
    form.querySelectorAll('input[name], select[name], textarea[name]').forEach(
        (el) => {
            if (el.type === 'checkbox') {
                if (el.checked) draft.checked.push([el.name, el.value]);
            } else {
                draft.fields[el.name] = el.value;
            }
        },
    );
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (e) {
        /* хранилище переполнено или запрещено, не критично */
    }
}

function loadDraft() {
    let draft = null;
    try {
        draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
    } catch (e) {
        /* битый JSON */
    }
    if (!draft) return false;

    Object.entries(draft.fields).forEach(([name, v]) => {
        const el = form.elements[name];
        if (el) el.value = v;
    });
    form.querySelectorAll('input[type=checkbox]').forEach((cb) => {
        cb.checked = draft.checked.some(
            ([n, v]) => n === cb.name && v === cb.value,
        );
    });

    $('#stepsTable tbody').innerHTML = '';
    $('#roleTimesTable tbody').innerHTML = '';
    (draft.steps.length ? draft.steps : [{}, {}]).forEach((s) => {
        const row = addRow('stepRowTpl', '#stepsTable tbody');
        row.querySelector('.step-who').value = s.who || '';
        row.querySelector('.step-what').value = s.what || '';
        if (s.where) row.querySelector('.step-where').value = s.where;
    });
    (draft.roleTimes.length ? draft.roleTimes : [{}]).forEach((r) => {
        const row = addRow('roleRowTpl', '#roleTimesTable tbody');
        row.querySelector('.role-name').value = r.role || '';
        row.querySelector('.role-min').value = r.min || '';
        row.querySelector('.role-kind').value = r.kind || 'op';
    });
    return true;
}

function resetForm() {
    form.reset();
    $('#stepsTable tbody').innerHTML = '';
    $('#roleTimesTable tbody').innerHTML = '';
    addRow('stepRowTpl', '#stepsTable tbody');
    addRow('stepRowTpl', '#stepsTable tbody');
    addRow('roleRowTpl', '#roleTimesTable tbody');
    showErrors = false;
    clearErrors();
    update();
}

// ---------- Единая точка обновления ----------
function update() {
    updateKind();
    renderCalc();
    renderChecklist();
    if (showErrors) validate(); // ошибка снимается сразу после заполнения поля
    if (editingId === null) saveDraft(); // при правке чужого содержимого черновик не затираем
}

// ---------- События ----------
form.addEventListener('input', update);

document.addEventListener('click', (e) => {
    if (e.target.classList.contains('del-row')) {
        e.target.closest('tr').remove();
        update();
    }
});

$('#addStep').addEventListener('click', () => {
    addRow('stepRowTpl', '#stepsTable tbody');
    update();
});

$('#addRole').addEventListener('click', () => {
    addRow('roleRowTpl', '#roleTimesTable tbody');
    update();
});

$('#fillRoles').addEventListener('click', () => {
    const existing = getRoleTimes().map((r) => r.role);
    form.querySelectorAll('[name="participants"]:checked').forEach((cb) => {
        if (!existing.includes(cb.value)) {
            const row = addRow('roleRowTpl', '#roleTimesTable tbody');
            row.querySelector('.role-name').value = cb.value;
        }
    });
    update();
});

// ---------- Отправка и очистка ----------
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showErrors = true;
    const failed = validate();
    if (failed.length) {
        showMessage(`Заполните отмеченные поля: ${failed.length}`, true);
        $(failed[0].target).scrollIntoView({
            behavior: 'smooth',
            block: 'center',
        });
        return;
    }
    const isEdit = editingId !== null;
    try {
        await api(
            isEdit ? 'PUT' : 'POST',
            isEdit ? `/api/requests/${editingId}` : '/api/requests',
            collectData(),
        );
    } catch (err) {
        showMessage(
            'Не удалось отправить: ' +
                err.message +
                '. Введённые данные сохранены.',
            true,
        );
        return;
    }
    if (isEdit) {
        leaveEditMode();
    } else {
        resetForm();
        localStorage.removeItem(DRAFT_KEY);
    }
    showMessage('');
    showView(
        'my',
        isEdit ? 'Заявка обновлена и отправлена повторно' : 'Заявка отправлена',
    );
});

$('#clearForm').addEventListener('click', () => {
    if (!confirm('Очистить форму?')) return;
    resetForm();
    if (editingId === null) localStorage.removeItem(DRAFT_KEY);
    showMessage('');
});

// ---------- Старт ----------
if (!loadDraft()) {
    addRow('stepRowTpl', '#stepsTable tbody');
    addRow('stepRowTpl', '#stepsTable tbody');
    addRow('roleRowTpl', '#roleTimesTable tbody');
}
update();
